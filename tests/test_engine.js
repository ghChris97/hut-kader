const fs=require('fs'); const path=process.argv[2];
require(path+'/app/engine.js');
const data=JSON.parse(fs.readFileSync(path+'/data/hut.json','utf8'));
const H=globalThis.HUT; let fail=0; const ok=(c,m)=>{ if(!c){fail++;console.log('FAIL',m);} else console.log('ok  ',m); };
const W={ovr:1,ap:0.5,sal:0.25};
const c0=data.combos[0];
const mk=(ct,tm,n)=>({ct,tm,n:n||('P'+Math.random()),ovr:80,sal:1,pos:'C',k:'s',id:Math.random()});
const need=c0.slots.map(s=>s[0]);
const fit=(r)=>r.kind==='card'?mk(r.ids[0],-1):mk(-1,r.ids[r.ids.length-1]);
ok(H.comboMatches(c0,[fit(need[2]),fit(need[0]),fit(need[1])]),'combo matches in any order (alias ids too)');
ok(!H.comboMatches(c0,[fit(need[0]),mk(-1,-1),mk(-2,-2)]),'incomplete line does not match');
let seed=7; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648; return seed/2147483648;};
const top=data.cards.filter(c=>c.ovr>=84);
const pick=(pos,n)=>{const a=top.filter(c=>c.pos===pos); const out=[]; const names=new Set(); while(out.length<n){const c=a[Math.floor(rnd()*a.length)]; if(!names.has(c.n)){names.add(c.n);out.push(c);}} return out;};
const owned=[...pick('LW',7),...pick('C',8),...pick('RW',7),...pick('LD',5),...pick('RD',5),...pick('G',3)];
let t=Date.now(); const r=H.optimize(data,owned,{strict:true,cap:0,w:W}); let ms=Date.now()-t;
ok(r.forwards.length===4&&r.defense.length===3&&r.goalies.length===2,'full lineup built ('+ms+' ms)');
const all=H.lineupPlayers(r);
ok(new Set(all.map(p=>p.n)).size===all.length,'no player twice');
ok(r.forwards.every(l=>l.players[0].pos==='LW'&&l.players[1].pos==='C'&&l.players[2].pos==='RW'),'strict positions kept');
const base=H.optimize({combos:[],coaches:[],captains:[],cards:[]},owned,{strict:true,cap:0,w:W});
ok(r.totals.raw>=base.totals.raw-1e-9,'optimizer >= OVR-only baseline ('+r.totals.raw.toFixed(1)+' vs '+base.totals.raw.toFixed(1)+')');
const capv=Math.floor((r.totals.sal-r.totals.salBoost)*0.8);
const rc=H.optimize(data,owned,{strict:true,cap:capv,w:W});
ok(!rc.capFailed&&(rc.totals.sal-rc.totals.salBoost<=capv+1e-9),'cap respected: '+(rc.totals.sal-rc.totals.salBoost).toFixed(1)+' <= '+capv);
// locks and bans
const bench=owned.filter(c=>c.k==='s'&&!all.includes(c)); const weak=bench.sort((a,b)=>a.ovr-b.ovr)[0];
const rl=H.optimize(data,owned,{strict:true,w:W,locks:{[H.key(weak)]:1}});
ok(H.lineupPlayers(rl).includes(weak),'locked bench player is in the lineup ('+weak.n+' '+weak.ovr+')');
const star=all.filter(p=>p.k==='s').sort((a,b)=>b.ovr-a.ovr)[0];
const rb=H.optimize(data,owned,{strict:true,w:W,bans:{[H.key(star)]:1}});
ok(!H.lineupPlayers(rb).includes(star),'banned player is not in the lineup');
// custom rating
const speed=H.rating({skating:1}); const rs=H.optimize(data,owned,{strict:true,w:W,val:speed});
const avgSkate=(res)=>{const ps=H.lineupPlayers(res).filter(p=>p.k==='s'); return ps.reduce((s,p)=>s+speed(p),0)/ps.length;};
ok(avgSkate(rs)>=avgSkate(r)-1e-9,'skating rating yields faster lineup ('+avgSkate(rs).toFixed(2)+' vs '+avgSkate(r).toFixed(2)+')');
// captain: build a roster around a captain card
const cap=data.captains[0]; const capCard=data.cards.find(c=>c.k===cap.k&&c.id===cap.id);
ok(!!capCard,'captain card exists in data: '+(capCard&&capCard.n));
const teamSet=new Set(cap.teams); const fromDiv=data.cards.filter(c=>c.k==='s'&&teamSet.has(c.tm)&&c.ovr>=80&&c.ovr<=84);
const names=new Set(owned.map(c=>c.n)); const extra=[]; for(const pos of ['LW','C','RW','LD','RD']){let n=0; for(const c of fromDiv){ if(c.pos===pos&&!names.has(c.n)&&n<2){names.add(c.n);extra.push(c);n++;} } }
const owned2=[...owned,capCard,...extra];
t=Date.now(); const rcap=H.optimize(data,owned2,{strict:true,w:{ovr:1,ap:2,sal:0.25}}); ms=Date.now()-t;
const cs=rcap.totals.captain;
ok(cs&&cs.active&&cs.count>=cap.need&&H.lineupPlayers(rcap).includes(capCard),'captain bonus reached when AP is prioritised: '+(cs?cs.count+'/'+cs.need+' +'+cs.boost:'none')+' ('+ms+' ms)');
ok(rcap.totals.ap>=cap.boost,'captain AP counted in totals ('+rcap.totals.ap+')');
// upgrades
t=Date.now(); const up=H.upgrades(data,r,{},20); ms=Date.now()-t;
ok(up.length===20&&up[0].delta>=up[19].delta&&up.every(u=>!owned.includes(u.card)),'upgrade finder returns sorted unowned cards ('+ms+' ms), best: '+up[0].card.n+' '+up[0].card.ovr+' +'+up[0].delta.toFixed(1));
// verify the top upgrade by really adding the card
const r2=H.optimize(data,[...owned,up[0].card],{strict:true,cap:0,w:W});
ok(r2.totals.raw>=r.totals.raw+up[0].delta-1e-6,'adding the top upgrade improves the real optimum by at least the estimate');
// near misses
const nm=H.nearMisses(data,r,{},8);
ok(nm.length>0&&nm.every(m=>m.slot&&m.replace),'near misses found: '+nm.length);
if(nm.length){const fl=H.fillers(data,nm[0],r,3); ok(fl.length>0,'fillers for first near miss: '+fl.map(f=>f.card.n).join(', '));
  const np=nm[0].line.players.map(p=>p===nm[0].replace?fl[0].card:p); ok(H.comboMatches(nm[0].combo,np),'filler really completes the combo');}
// special teams + saved lineup
const st=H.specialTeams(r); ok(st.pp[0].f.length===3&&st.pp[0].d.length===2&&st.pk[0].f.length===2,'special teams built');
const byKey={}; data.cards.forEach(c=>byKey[H.key(c)]=c);
const saved={f:r.forwards.map(l=>l.players.map(H.key)),d:r.defense.map(l=>l.players.map(H.key)),g:r.goalies.map(H.key)};
const re=H.evaluate(data,saved,{w:W},byKey); ok(Math.abs(re.totals.raw-r.totals.raw)<1e-6,'saved lineup re-evaluates to the same value');
// big roster timing
const big=[...pick('LW',12),...pick('C',14),...pick('RW',12),...pick('LD',10),...pick('RD',10),...pick('G',4)];
t=Date.now(); const rbig=H.optimize(data,big,{strict:false,cap:0,coach:data.coaches[0].name,w:W}); ok(rbig.forwards.length===4,'big roster, free positions ('+(Date.now()-t)+' ms)');
// Verteidiger nach Schusshand
const dOwned=owned.filter(c=>c.k==='s'&&(c.pos==='LD'||c.pos==='RD'));
const rh=H.optimize(data,owned,{strict:true,w:W,dHand:'off'});
const mixedBefore=r.defense.filter(H.mixedPair).length, mixedAfter=rh.defense.filter(H.mixedPair).length;
ok(rh.defense.length===3&&mixedAfter>=mixedBefore,'hand mode keeps 3 pairs and prefers mixed hands ('+mixedBefore+' -> '+mixedAfter+')');
const pair=rh.defense.find(H.mixedPair);
if(pair){ const s1=H.sidesD(pair.players,'off'); ok(s1[0].hand==='R'&&s1[1].hand==='L','off-hand: right shooter left, left shooter right');
  const s2=H.sidesD(pair.players,'on'); ok(s2[0].hand==='L'&&s2[1].hand==='R','on-hand: left shooter left'); }
const same=dOwned.filter(c=>c.hand==='L').slice(0,2); if(same.length===2){ const s3=H.sidesD(same,'off'); ok(s3.length===2&&s3[0]&&s3[1],'same-hand pair still placed'); }
process.exit(fail?1:0);
