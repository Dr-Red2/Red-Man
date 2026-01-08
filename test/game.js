const COLS=28, ROWS=31, TILE=16;
const canvas=document.getElementById('game');
const ctx=canvas.getContext('2d');
canvas.width=COLS*TILE; canvas.height=ROWS*TILE;

let hero={x:14*TILE, y:23*TILE, dir:'none'};

function dirVec(d){
  return d==='up'?{x:0,y:-1}:
         d==='down'?{x:0,y:1}:
         d==='left'?{x:-1,y:0}:
         d==='right'?{x:1,y:0}:{x:0,y:0};
}

function render(){
  ctx.fillStyle='#000';
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // simple border walls
  ctx.fillStyle='#1b2fd2';
  ctx.fillRect(0,0,canvas.width, TILE); // top
  ctx.fillRect(0,canvas.height-TILE,canvas.width,TILE); // bottom
  ctx.fillRect(0,0,TILE,canvas.height); // left
  ctx.fillRect(canvas.width-TILE,0,TILE,canvas.height); // right

  // hero
  ctx.fillStyle='#fc0';
  ctx.beginPath();
  ctx.arc(hero.x, hero.y, TILE/2-2, 0, Math.PI*2);
  ctx.fill();
}

function update(){
  const v=dirVec(hero.dir);
  hero.x+=v.x*2; hero.y+=v.y*2;
}

function loop(){
  update();
  render();
  requestAnimationFrame(loop);
}
loop();

window.addEventListener('keydown',e=>{
  const mapKeys={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right',
                 KeyW:'up',KeyS:'down',KeyA:'left',KeyD:'right'};
  const d=mapKeys[e.code];
  if(d)hero.dir=d;
});
