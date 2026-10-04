import * as THREE from 'three/webgpu';
import { FaceSkin, BELLY_WINDOW } from '../graphics/character/face-skin.ts';
import { JELLY_FLAVORS, DEFAULT_JELLY_FLAVOR, type JellyFlavorName } from '../graphics/character/jelly-flavors.ts';
import type { SoftBody } from '../physics/soft-body.js';

/** Things the pet has swallowed, seen through her.
 *
 * Her material is fully transmissive, which in three means it samples the
 * framebuffer as it stands at the moment she is drawn. Anything opaque is drawn
 * before her, so anything opaque placed inside her body is inside her on screen
 * too: refracted, tinted by her flavour's absorption, blurred by her roughness.
 * None of that costs a line of shader code. Her eyes have always worked this way.
 *
 * The catch is the word opaque. A cut-out icon with an alpha edge would sort into
 * the transparent pass, which runs after her, and would never reach her backdrop
 * at all. So the icon is composited onto a solid card first, and the card is what
 * goes in. It also reads better: a card is an object, a floating cut-out is a sticker.
 *
 * The cards ride the skin rather than the body's centre. Each frame one sampler
 * lookup gives the deformed belly surface at a fixed rest-space spot, and the card
 * hangs a few millimetres inside it along the normal. So it leans when she leans,
 * jolts when she lands, and sinks away when she is squashed, because it is reading
 * the same triangles the solver just moved.
 */

/** Card face in metres. She is 70 mm tall, so this is about a fifth of her. */
const CARD={size:.0140,thickness:.0021,sink:.0086};
/** Where cards sit in her belly, front of the stack first. Heights stay under
 * the mouth at 38.9 mm so nothing crowds her face. */
const SLOTS=[
  {x:-.0078,y:.0332,roll:.12,back:0},
  {x:.0086,y:.0300,roll:-.17,back:.0026},
  {x:-.0064,y:.0272,roll:-.06,back:.0052},
  {x:.0056,y:.0358,roll:.20,back:.0078},
];
/** Metres of jelly the light crosses on its way out: her material's own figure. */
const THROUGH=.035;
/** What a card's own light should come to once she has had her way with it. */
const PAPER=.82;
/** Past this many she keeps carrying them, she just stops showing them. */
export const SHELF_SLOTS=SLOTS.length;

const TILE=192;
/** Type colours, by what the thing is rather than by extension. */
const KINDS:Record<string,string>={
  IMAGE:'#3b7ea1',DOC:'#b4562a',SHEET:'#2f7d4f',DECK:'#b03a3a',
  VIDEO:'#6b4ba8',SOUND:'#a8842b',CODE:'#3f6b8a',FOLDER:'#7a6a52',FILE:'#6b6259',
};
const POLE=new THREE.Vector3(0,0,1);

type Slot={x:number;y:number;roll:number;back:number};
type Card={
  key:string;mesh:THREE.Mesh;face:THREE.MeshStandardNodeMaterial;edge:THREE.MeshStandardNodeMaterial;
  texture:THREE.CanvasTexture;canvas:HTMLCanvasElement;painted:string|null;
  at:Slot;target:Slot;grown:number;leaving:boolean;out:THREE.Vector3;
};

/** Paint a card the light cannot see through.
 *
 * A preview arrives well after the file does, and some never arrive at all, so
 * every card can be painted twice: once with the file's type, once with its
 * picture. The ground is always filled edge to edge. A cut-out with an alpha
 * edge would sort into the transparent pass, which draws after her, and would
 * never reach the backdrop she refracts.
 */
function paint(canvas:HTMLCanvasElement,icon:HTMLImageElement|null,label:string,kind:string) {
  const ctx=canvas.getContext('2d')!;
  const wash=ctx.createLinearGradient(0,0,0,TILE);
  wash.addColorStop(0,'#fffdf9');wash.addColorStop(1,'#e8dccd');
  ctx.fillStyle=wash;ctx.fillRect(0,0,TILE,TILE);
  const band=TILE*.28;
  if(icon&&icon.width&&icon.height) {
    // Previews come back at the file's own shape, not square.
    const pad=TILE*.05,room=TILE-pad*2,floor=TILE-band-pad;
    const scale=Math.min(room/icon.width,floor/icon.height);
    const w=icon.width*scale,h=icon.height*scale;
    ctx.drawImage(icon,(TILE-w)/2,(floor-h)/2+pad,w,h);
  }
  // The preview is the reward for looking closely. The band is what actually
  // reads: she is two hundred pixels tall on screen and a card inside her is
  // thirty, which is room for four bold letters and no room at all for the
  // first slide of somebody's deck.
  ctx.fillStyle=KINDS[kind]??KINDS.FILE;
  ctx.fillRect(0,TILE-band,TILE,band);
  ctx.fillStyle='#fffdf8';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.font=`800 ${label.length>4?TILE*.155:TILE*.19}px system-ui, sans-serif`;
  ctx.fillText(label,TILE/2,TILE-band/2+TILE*.012);
}

export type ShelfItem={key:string;icon:string|null;label?:string;kind?:string};

export class Shelf {
  private readonly skin:FaceSkin;
  private readonly sample=new Float64Array(6);
  private readonly cards:Card[]=[];
  private readonly spin=new THREE.Quaternion();
  private readonly normal=new THREE.Vector3();
  private readonly geometry=new THREE.BoxGeometry(CARD.size,CARD.size,CARD.thickness);
  private readonly group:THREE.Group;
  private readonly tint=new THREE.Color(1,1,1);
  constructor(body:SoftBody,group:THREE.Group) {
    this.group=group;this.skin=new FaceSkin(body,1,BELLY_WINDOW);
    this.setFlavor(DEFAULT_JELLY_FLAVOR);
  }

  /** Undo her, so a card arrives looking like itself.
   *
   * What she does to anything behind her is a multiply by exp(-absorption times
   * thickness), which for the pink is about (0.98, 0.30, 0.58): the green is all
   * but gone. Dividing a card's own light by that same figure puts it back, and
   * the picture reads in its own colours rather than as a pink stain. Simply
   * turning the card up cannot do this, because brightness lifts all three
   * channels together and the ratio between them is the whole problem. Two of
   * the three numbers come out above one, which is fine: the tone mapping folds
   * the excess back towards white instead of clipping it.
   */
  setFlavor(flavor:JellyFlavorName) {
    const absorption=JELLY_FLAVORS[flavor].absorption;
    this.tint.setRGB(
      PAPER/Math.exp(-absorption[0]*THROUGH),
      PAPER/Math.exp(-absorption[1]*THROUGH),
      PAPER/Math.exp(-absorption[2]*THROUGH),
      THREE.LinearSRGBColorSpace,
    );
    for(const card of this.cards) {
      card.face.emissive.copy(this.tint);
      card.edge.emissive.copy(this.tint).multiplyScalar(.62);
    }
  }

  /** The whole contents, newest first. Cards already shown keep their place. */
  show(items:readonly ShelfItem[]) {
    const wanted=items.slice(0,SHELF_SLOTS);
    for(const card of this.cards)card.leaving=!wanted.some(item=>item.key===card.key);
    wanted.forEach((item,index)=>{
      const card=this.cards.find(existing=>existing.key===item.key&&!existing.leaving)??this.adopt(item);
      // Targets are slots, not positions: a card that has to move back because
      // something newer arrived eases through the stack instead of jumping.
      card.target=SLOTS[index];
      if(item.icon&&item.icon!==card.painted){card.painted=item.icon;this.repaint(card,item);}
    });
  }

  private adopt(item:ShelfItem):Card {
    const card=this.build(item);this.cards.push(card);return card;
  }

  /** Wait for the picture before touching the card: an Image is not drawable
   *  until it has decoded, and a half-decoded one paints nothing at all. */
  private repaint(card:Card,item:ShelfItem) {
    const image=new Image();
    const done=(picture:HTMLImageElement|null)=>{
      paint(card.canvas,picture,item.label??'',item.kind??'FILE');card.texture.needsUpdate=true;};
    image.onload=()=>done(image);image.onerror=()=>done(null);
    image.src=item.icon!;
  }

  private build(item:ShelfItem):Card {
    const canvas=document.createElement('canvas');
    canvas.width=canvas.height=TILE;
    paint(canvas,null,item.label??'',item.kind??'FILE');
    const texture=new THREE.CanvasTexture(canvas);
    texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=4;
    // Emissive carries the picture, because the lit surface alone cannot get
    // out of her. See setFlavor for what is in that colour.
    const face=new THREE.MeshStandardNodeMaterial({
      map:texture,roughness:.52,metalness:0,emissiveMap:texture,emissiveIntensity:1,
    });
    face.emissive=this.tint.clone();
    const edge=new THREE.MeshStandardNodeMaterial({color:'#e9ded0',roughness:.6,metalness:0});
    edge.emissive=this.tint.clone().multiplyScalar(.62);
    // The picture goes on both faces. She turns away as she walks, and a slab
    // seen from behind is a dark wedge floating in her; seen from behind with
    // the picture on it, it is still the file.
    const mesh=new THREE.Mesh(this.geometry,[edge,edge,edge,edge,face,face]);
    mesh.frustumCulled=false;mesh.renderOrder=0;mesh.scale.setScalar(.001);
    this.group.add(mesh);
    const first=SLOTS[0];
    return {key:item.key,mesh,face,edge,texture,canvas,painted:null,
      at:{...first},target:first,grown:0,leaving:false,out:new THREE.Vector3(0,0,1)};
  }

  update(dt:number) {
    for(let i=this.cards.length-1;i>=0;i--) {
      const card=this.cards[i];
      const want=card.leaving?0:1;
      // Swallowing is a card growing into place; giving one back is the reverse.
      card.grown+=Math.sign(want-card.grown)*Math.min(Math.abs(want-card.grown),dt*3.2);
      if(card.leaving&&card.grown<=.001){this.retire(card);this.cards.splice(i,1);continue;}
      const ease=Math.min(1,dt*7);
      const to=card.target;
      card.at.x+=(to.x-card.at.x)*ease;card.at.y+=(to.y-card.at.y)*ease;
      card.at.roll+=(to.roll-card.at.roll)*ease;card.at.back+=(to.back-card.at.back)*ease;
      // A card that has just arrived sits shallower and swings in, so the eye
      // catches it near the skin before it settles into the stack.
      const settle=card.grown*card.grown*(3-2*card.grown);
      const depth=CARD.sink*settle+card.at.back;
      try{this.skin.sample(card.at.x,card.at.y,-depth,this.sample);}catch{continue;}
      card.mesh.position.set(this.sample[0],this.sample[1],this.sample[2]);
      this.normal.set(this.sample[3],this.sample[4],this.sample[5]);
      card.mesh.quaternion.setFromUnitVectors(POLE,this.normal);
      card.out.copy(this.normal);
      this.spin.setFromAxisAngle(POLE,card.at.roll+(1-settle)*.9);
      card.mesh.quaternion.multiply(this.spin);
      card.mesh.scale.setScalar(Math.max(.001,settle));
      card.mesh.visible=settle>.01;
    }
  }

  /** Where the cards are, front of the stack first, so the shell can let
   *  someone take hold of the one they are looking at rather than the one that
   *  happens to be newest. A card is only offered while it is fully out and
   *  facing the way it is drawn; she turns as she walks, and a card on her far
   *  side still lands on the same pixels as one on the near side. */
  places():{key:string;at:THREE.Vector3;out:THREE.Vector3;r:number}[] {
    return this.cards
      .filter(card=>!card.leaving&&card.grown>.6)
      .sort((a,b)=>a.at.back-b.at.back)
      .map(card=>({key:card.key,at:card.mesh.position,out:card.out,
        r:CARD.size*.5*card.mesh.scale.x}));
  }

  private retire(card:Card) {
    card.mesh.removeFromParent();
    card.texture.dispose();card.face.dispose();card.edge.dispose();
  }

  dispose() {
    for(const card of this.cards)this.retire(card);
    this.cards.length=0;this.geometry.dispose();
  }
}
