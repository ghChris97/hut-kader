const fs=require('fs'); const path=process.argv[2];
require(path+'/app/engine.js');
const data=JSON.parse(fs.readFileSync(path+'/data/hut.json','utf8'));
const H=globalThis.HUT; let fail=0; const ok=(c,m)=>{ if(!c){fail++;console.log('FAIL',m);} else console.log('ok  ',m); };
// 1) combo matching: first forwards combo: Alumni card + QUE team + DAL team
const c0=data.combos[0];
const mk=(ct,tm,n)=>({ct,tm,n:n||('P'+Math.random()),ovr:80,sal:1,pos:'C',k:'s'});
ok(H.comboMatches(c0,[mk(1,10),mk(8,999),mk(2,71)]),'combo matches in any order');
ok(!H.comboMatches(c0,[mk(8,71),mk(1,1),mk(2,10)]),'one card cannot fill two slots');
ok(H.comboMatches(c0,[mk(8,71),mk(8,47),mk(2,71)]),'alias team id counts');
// 2) optimizer on a realistic random roster
let seed=7; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648; return seed/2147483648;};
const top=data.cards.filter(c=>c.ovr>=84);
const pick=(pos,n)=>{const a=top.filter(c=>c.pos===pos); const out=[]; const names=new Set(); while(out.length<n){const c=a[Math.floor(rnd()*a.length)]; if(!names.has(c.n)){names.add(c.n);out.push(c);}} return out;};
const owned=[...pick('LW',7),...pick('C',8),...pick('RW',7),...pick('LD',5),...pick('RD',5),...pick('G',3)];
let t=Date.now(); const r=H.optimize(data,owned,{strict:true,cap:0,w:{ovr:1,ap:0.5,sal:0.25}}); const ms=Date.now()-t;
ok(r.forwards.length===4&&r.defense.length===3&&r.goalies.length===2,'full lineup built ('+ms+' ms)');
const all=[...r.forwards.flatMap(l=>l.players),...r.defense.flatMap(l=>l.players),...r.goalies];
ok(new Set(all.map(p=>p.n)).size===all.length,'no player twice');
ok(r.forwards.every(l=>l.players[0].pos==='LW'&&l.players[1].pos==='C'&&l.players[2].pos==='RW'),'strict positions kept');
console.log('   totals',JSON.stringify(r.totals));
r.forwards.forEach(l=>console.log('   F',l.players.map(p=>p.n+' '+p.ovr+' '+p.ctn+'/'+p.tmn).join(' | '),JSON.stringify(l.boosts)));
// 3) naive baseline: best by OVR without chemistry must not beat the optimizer's raw score
const base=H.optimize({combos:[],coaches:[]},owned,{strict:true,cap:0,w:{ovr:1,ap:0.5,sal:0.25}});
ok(r.totals.raw>=base.totals.raw-1e-9,'optimizer >= OVR-only baseline ('+r.totals.raw.toFixed(1)+' vs '+base.totals.raw.toFixed(1)+')');
// 4) cap constraint
const capv=Math.floor((r.totals.sal-r.totals.salBoost)*0.8);
t=Date.now(); const rc=H.optimize(data,owned,{strict:true,cap:capv,w:{ovr:1,ap:0.5,sal:0.25}});
ok(rc.capFailed|| (rc.totals.sal-rc.totals.salBoost<=capv+1e-9),'cap respected: '+(rc.totals.sal-rc.totals.salBoost).toFixed(1)+' <= '+capv+' ('+(Date.now()-t)+' ms)'+(rc.capFailed?' FAILED-FLAG':''));
// 5) free positions + coach, big roster timing
const big=[...pick('LW',12),...pick('C',14),...pick('RW',12),...pick('LD',10),...pick('RD',10),...pick('G',4)];
t=Date.now(); const rb=H.optimize(data,big,{strict:false,cap:0,coach:data.coaches[0].name,w:{ovr:1,ap:0.5,sal:0.25}});
ok(rb.forwards.length===4,'big roster free positions ('+(Date.now()-t)+' ms)');
// 6) small roster
const rs=H.optimize(data,owned.slice(0,5),{strict:true,cap:0});
ok(rs.missing.f>0&&rs.missing.d===3,'small roster reports missing lines '+JSON.stringify(rs.missing));
process.exit(fail?1:0);
