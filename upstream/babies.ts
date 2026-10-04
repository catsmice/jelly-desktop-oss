import * as THREE from 'three/webgpu';
import { attribute } from 'three/tsl';
import { SoftBody } from '../physics/soft-body.js';
import { parseBabyCage, type ModelManifest } from '../physics/baby-cage.ts';
import { FaceSkin } from '../graphics/character/face-skin.ts';
import { JELLY_FLAVORS, type JellyFlavorName } from '../graphics/character/jelly-flavors.ts';
import { Locomotion } from './locomotion.ts';

/** Small jellies that keep the mother company.
 *
 * Each one is a full soft body with its own solver instance and its own rig, so
 * it walks with the same gait rather than being animated at. What makes three of
 * them affordable is the model: a separate build of the same implicit shape at
 * 40% height on a coarser cage, which costs about a quarter of what she does.
 *
 * They are deliberately simpler than the mother above the neck. Her face is
 * rebuilt every frame from the deformed skin, which is the most expensive single
 * thing in the frame; at fifty-odd points on screen a baby only needs eyes, and
 * eyes are two samples of the skin rather than a per-vertex pass.
 */
export type BabyJelly = {
  readonly body:SoftBody;
  readonly rig:Locomotion;
  readonly group:THREE.Group;
  readonly mesh:THREE.Mesh;
  readonly flavor:JellyFlavorName;
  /** Where the soles of this baby should be, while something is carrying it. */
  carry:{x:number;y:number;z:number}|null;
  /** Rest height of the lowest cage node, so a carry point means the soles. */
  readonly soleOffset:number;
  step(h:number):void;
  update():void;
  dispose():void;
};

/** The mother is 7 cm; these are hers, scaled. */
const SMALL=.4;
const EYE={x:.0095*SMALL,y:.0465*SMALL,depth:.0001*SMALL,size:[.00325*SMALL,.0043*SMALL,.0015*SMALL]} as const;

/** Put a body down somewhere, the way the facilities move the mother about. */
export function placeBody(body:SoftBody,x:number,z:number) {
  for(let i=0;i<body.x.length;i+=3) {
    body.x[i]=body.rest[i]+x;body.x[i+1]=body.rest[i+1];body.x[i+2]=body.rest[i+2]+z;
  }
  body.previous.set(body.x);body.velocity.fill(0);
  body.updateCenter();body.wake();body.surfaceDirty=true;body.updateSurface();
}

export async function loadBabyJellies(
  scene:THREE.Object3D,flavors:readonly JellyFlavorName[],spread=.09,
):Promise<BabyJelly[]> {
  const [binary,metadata]=await Promise.all([
    fetch(new URL('../assets/model/jelly-baby-small.bin',import.meta.url)),
    fetch(new URL('../assets/model/jelly-baby-small.json',import.meta.url)),
  ]);
  if(!binary.ok||!metadata.ok)throw new Error('Could not load the small jelly mesh');
  const buffer=await binary.arrayBuffer(),manifest=await metadata.json() as ModelManifest;

  return flavors.map((flavor,index)=>{
    // One parse each: the cage copies its own positions, and two bodies sharing
    // a surface would overwrite each other's skin every frame.
    const cage=parseBabyCage(buffer,manifest);
    const look=JELLY_FLAVORS[flavor];
    const attenuationDistance=.014;
    const material=new THREE.MeshPhysicalNodeMaterial({
      color:look.surface,roughness:.085,metalness:0,transmission:1,thickness:.014,
      ior:1.35,dispersion:.025,attenuationDistance,
      clearcoat:.42,clearcoatRoughness:.05,envMapIntensity:1.05,
      transparent:false,side:THREE.FrontSide,flatShading:false,
    });
    material.attenuationColor.setRGB(
      Math.exp(-look.absorption[0]*attenuationDistance),
      Math.exp(-look.absorption[1]*attenuationDistance),
      Math.exp(-look.absorption[2]*attenuationDistance),
      THREE.LinearSRGBColorSpace,
    );
    // The loader fills view thickness for a 7 cm body; at 40% the light has far
    // less jelly to cross, and leaving it would make a small one look muddy.
    (cage.surface.geometry.getAttribute('opticalThickness').array as Float32Array).fill(.016);
    material.thicknessNode=attribute('opticalThickness','float');

    const body=new SoftBody(cage);
    const group=new THREE.Group();
    const mesh=new THREE.Mesh(body.surface.geometry,material);
    mesh.renderOrder=1;mesh.frustumCulled=false;group.add(mesh);

    const skin=new FaceSkin(body,SMALL);
    const sample=new Float64Array(6);
    const eyeMaterial=new THREE.MeshPhysicalNodeMaterial({color:'#2a1018',roughness:.13,clearcoat:1,clearcoatRoughness:.06});
    const eyes=[-1,1].map(side=>{
      const geometry=new THREE.SphereGeometry(1,18,12,0,Math.PI*2,0,Math.PI/2)
        .rotateX(Math.PI/2).scale(EYE.size[0],EYE.size[1],EYE.size[2]);
      const eye=new THREE.Mesh(geometry,eyeMaterial);
      eye.renderOrder=2;eye.frustumCulled=false;
      (eye.material as THREE.Material).transparent=true;
      group.add(eye);
      return {mesh:eye,side};
    });
    scene.add(group);

    const rig=new Locomotion(body);
    placeBody(body,(index-(flavors.length-1)/2)*spread,spread);

    const normal=new THREE.Vector3(),pole=new THREE.Vector3(0,0,1);
    const placeEyes=()=>{
      for(const {mesh:eye,side} of eyes) {
        skin.sample(side*EYE.x,EYE.y,EYE.depth,sample);
        eye.position.set(sample[0],sample[1],sample[2]);
        normal.set(sample[3],sample[4],sample[5]);
        eye.quaternion.setFromUnitVectors(pole,normal);
      }
    };

    let soleOffset=Infinity;
    for(let i=1;i<body.rest.length;i+=3)soleOffset=Math.min(soleOffset,body.rest[i]);

    return {
      body,rig,group,mesh,flavor,soleOffset,
      carry:null as {x:number;y:number;z:number}|null,
      step(h:number){
        rig.step(h);
        // Being carried is a spring towards the rest pose at a point, node by
        // node, which is how the trampoline holds whoever is bouncing on it. A
        // grab would do the same job with three constraints and far more force
        // than a twelve-gram body can take: it pulls the arms out like taffy.
        const place=this.carry;
        if(place) {
          const b=this.body;
          for(let i=0;i<b.mass.length;i++) {
            const j=i*3;
            b.velocity[j]+=(900*(place.x+b.rest[j]-b.x[j])-30*b.velocity[j])*h;
            b.velocity[j+1]+=(900*(place.y+b.rest[j+1]-b.x[j+1])-30*b.velocity[j+1])*h;
            b.velocity[j+2]+=(900*(place.z+b.rest[j+2]-b.x[j+2])-30*b.velocity[j+2])*h;
          }
          b.canSleep=false;b.wake();
        }
        body.step(h);
      },
      update(){if(body.surfaceDirty)body.updateSurface();placeEyes();},
      dispose(){
        group.removeFromParent();
        body.surface.geometry.dispose();material.dispose();eyeMaterial.dispose();
        for(const {mesh:eye} of eyes)eye.geometry.dispose();
      },
    };
  });
}
