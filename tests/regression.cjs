// Node >=22.13. No network, real payments, email, or database writes.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');
const root = path.resolve(__dirname,'..');
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
function fn(name) {
  const start = html.search(new RegExp('(?:async )?function '+name+'\\('));
  assert.ok(start >= 0, name);
  const endLine = html.indexOf('\n',start);
  const line = html.slice(start,endLine);
  if (line.trim().endsWith('}')) return line;
  const end = html.indexOf('\n}',start);
  return html.slice(start,end+2);
}
function loadTS(file,context) {
  let source=fs.readFileSync(path.join(root,file),'utf8');
  source=source.replace(/^import\b[\s\S]*?;\s*/gm,'').replace(/\bexport /g,'');
  vm.runInContext(stripTypeScriptTypes(source),context);
}
function auditStore() {
 const rows=new Map();
 return {findUnique:async({where})=>rows.get(where.id)||null,
 upsert:async({where,create,update})=>{const row=rows.has(where.id)?Object.assign(rows.get(where.id),update):{createdAt:new Date(),...create};rows.set(where.id,row);return row},
 updateMany:async({where,data})=>{const row=rows.get(where.id);if(!row||row.action!==where.action||+row.createdAt!==+where.createdAt)return{count:0};Object.assign(row,data);return{count:1}}};
}
function fixture(status='PENDING_PAYMENT') {
  const booking={id:'b1',emptyLegId:'l1',bookingType:'SPLIT',status,totalAmount:'100',currency:'EUR',bookerEmail:'owner@example.test',
    createdAt:new Date(Date.now()-3600000),emptyLeg:{status:'PUBLISHED',departureAt:new Date(Date.now()+86400000),operator:{contactEmail:'op@example.test'}}};
  const payments=[{id:'p1',bookingId:'b1',amount:'50',currency:'EUR',status:'PENDING',stripeCheckoutSessionId:'cs1'},
    {id:'p2',bookingId:'b1',amount:'50',currency:'EUR',status:'PENDING',stripeCheckoutSessionId:'cs2'}];
  let queue=Promise.resolve(); let handler; const refunds=[]; const notifications=[];
  booking.payments=payments;
  const db={
    auditLog:auditStore(),
    $queryRaw:async()=>[],
    booking:{findUnique:async()=>structuredClone(booking),findUniqueOrThrow:async()=>structuredClone(booking),
      update:async({data})=>Object.assign(booking,data), updateMany:async({where,data})=>{
        if(where.status && where.status!==booking.status)return {count:0};Object.assign(booking,data);return {count:1};}},
    bookingPayment:{findUnique:async({where})=>structuredClone(payments.find(p=>p.id===where.id)),
      update:async({where,data})=>Object.assign(payments.find(p=>p.id===where.id),data),
      updateMany:async({where,data})=>{const p=payments.find(p=>p.id===where.id);if(p.status!==where.status)return{count:0};Object.assign(p,data);return{count:1}},
      count:async()=>payments.filter(p=>p.status!=='PAID').length},
    emptyLeg:{update:async({data})=>Object.assign(booking.emptyLeg,data)},
  };
  db.$transaction=cb=>{const next=queue.then(()=>cb(db));queue=next.catch(()=>{});return next;};
  const context=vm.createContext({console,Date,Error,Math,Number,Set,
    Router:()=>({post:(_url,...handlers)=>handler=handlers.at(-1)}),express:{raw:()=>()=>{}},
    PrismaPg:class{},PrismaClient:class{constructor(){return db}},Stripe:class{constructor(){return {webhooks:{constructEvent:body=>body}}}},
    env:{},logger:{info(){},error(){},warn(){}},
    refundBookingPayments:async id=>{refunds.push(id);return{refundedEmails:[]}},expirePendingCheckoutSessions:async()=>{},
    sendPaymentConfirmedEmail:async()=>{notifications.push('customer');return true},sendOperatorBookingNotification:async()=>{notifications.push('operator');return true},sendRefundIssuedEmail:async()=>true,sendBookingConfirmedEmail:async()=>true
  });
  loadTS('backend/src/services/checkoutState.service.ts',context);
  loadTS('backend/src/services/bookingNotifications.service.ts',context);
  loadTS('backend/src/routes/stripeWebhook.routes.ts',context);
  async function event(type='checkout.session.completed',id='p1',extra={}){
    const p=payments.find(p=>p.id===id);let code=200;
    const req={headers:{'stripe-signature':'fixture'},body:{type,data:{object:{id:p?.stripeCheckoutSessionId||'wrong',metadata:{bookingId:'b1',bookingPaymentId:id},payment_intent:'pi_'+id,payment_status:'paid',amount_total:5000,currency:'eur',...extra}}}};
    const res={status(n){code=n;return this},json(){return this},send(){return this}};
    await handler(req,res);return code;
  }
  return {booking,payments,event,refunds,notifications,db,context};
}

test('concurrent split payments transition to PAID exactly once',async()=>{
 const f=fixture();assert.deepEqual(await Promise.all([f.event(),f.event('checkout.session.completed','p2')]),[200,200]);
 assert.equal(f.booking.status,'PAID');assert.equal(f.notifications.length,2);
 await f.event();assert.equal(f.notifications.length,2);
});
test('one paid share does not activate booking',async()=>{const f=fixture();await f.event();assert.equal(f.booking.status,'PENDING_PAYMENT')});
test('unpaid completion does not mark share paid',async()=>{const f=fixture();await f.event(undefined,'p1',{payment_status:'unpaid'});assert.equal(f.payments[0].status,'PENDING')});
test('late paid share after expiry is recorded then refunded',async()=>{const f=fixture('EXPIRED');await f.event();assert.equal(f.booking.status,'EXPIRED');assert.equal(f.payments[0].status,'PAID');assert.deepEqual(f.refunds,['b1'])});
test('expiry retry still retries refunds on terminal booking',async()=>{const f=fixture('EXPIRED');await f.event('checkout.session.expired');assert.deepEqual(f.refunds,['b1'])});
test('stale expiry cannot cancel a paid share or booking',async()=>{const f=fixture();await f.event();await f.event('checkout.session.expired');assert.equal(f.booking.status,'PENDING_PAYMENT');const paid=fixture('PAID');await paid.event('checkout.session.expired');assert.equal(paid.booking.status,'PAID')});
test('mismatched amount and foreign session rejected',async()=>{const f=fixture();assert.equal(await f.event(undefined,'p1',{amount_total:1}),500);assert.equal(await f.event(undefined,'p1',{id:'foreign_session'}),500);assert.equal(f.booking.status,'PENDING_PAYMENT')});
test('cancelled flight cannot be confirmed or republished',async()=>{
 const f=fixture('PAID');f.booking.emptyLeg.status='CANCELLED';loadTS('backend/src/services/bookingState.service.ts',f.context);
 await assert.rejects(()=>f.context.confirmPaidBooking(f.db,'b1'));
 await f.context.closeBooking(f.db,'b1','CANCELLED');assert.equal(f.booking.emptyLeg.status,'CANCELLED');
});
test('confirmation rechecks current status inside transaction',async()=>{const f=fixture('EXPIRED');loadTS('backend/src/services/bookingState.service.ts',f.context);await assert.rejects(()=>f.context.confirmPaidBooking(f.db,'b1'));assert.equal(f.booking.status,'EXPIRED')});
test('204 delete is accepted without parsing JSON',async()=>{
 const c=vm.createContext({API_BASE_URL:'https://example.test',auth0Client:null,fetch:async()=>({ok:true,status:204,text:()=>{throw Error('must not read')}})});
 vm.runInContext(fn('apiFetch'),c);assert.equal(await c.apiFetch('/passengers/1',{method:'DELETE'}),null);
});
test('inspire clears prior search visibility and keeps map dataset aligned',()=>{
 const cards=['a','b'].map(id=>{const classes=new Set();return{dataset:{legId:id},style:{display:id==='b'?'none':''},classList:{toggle:(name,on)=>on?classes.add(name):classes.delete(name),contains:name=>classes.has(name)}}});let mapped;
 const c=vm.createContext({allEmptyLegs:[{id:'a',fromAirport:'LIN'},{id:'b',fromAirport:'GVA'}],matchesLocation:(leg,side,from)=>from==='*'||leg.fromAirport===from,
 document:{getElementById:id=>id==='el-inspire-from'?{value:'*'}:{},querySelectorAll:()=>cards},renderRoutesMap:list=>mapped=list});
 vm.runInContext(fn('renderInspireResults'),c);c.renderInspireResults();assert.deepEqual(cards.map(x=>x.style.display),['','']);assert.deepEqual(cards.map(x=>x.classList.contains('el-filtered-out')),[false,false]);assert.equal(mapped.length,2);
});

test('filtered Empty Leg cards stay hidden in list view and mobile map is edge-to-edge',()=>{
 assert.ok(html.includes('#empty-leg-grid .el-card.el-filtered-out{display:none!important}'));
 assert.ok(html.includes("classList.toggle('el-filtered-out',hidden)"));
 assert.ok(html.includes('.map-wrap{margin:0 0 64px!important;width:100%!important;max-width:none!important;border-radius:0!important}'));
});
test('FULL booking cannot represent multiple participants paying through one checkout',()=>{
 const src=fs.readFileSync(path.join(root,'backend/src/routes/bookings.routes.ts'),'utf8');
 assert.ok(src.includes('data.bookingType === "FULL" && data.passengers.length !== 1'));
 assert.ok(src.includes("Con piu' partecipanti ogni passeggero deve pagare la propria quota"));
});
test('flight markup treats apostrophes and HTML as text; no executable booking data',()=>{
 const c=vm.createContext({});vm.runInContext(fn('escapeHTML'),c);
 assert.equal(c.escapeHTML(`O'Brien <img onerror="x">`),'O&#039;Brien &lt;img onerror=&quot;x&quot;&gt;');
 assert.ok(!/onclick="selectedEmptyLegId=/.test(html));
 assert.ok(html.includes('data-book-leg="${escapeHTML(leg.id)}"'));
});
test('all public app copies have same script blocks and Passenger Wallet',()=>{
 const scripts=s=>[...s.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(m=>!m[1].includes('application/ld+json')).map(m=>m[0]);
 for(const route of ['empty-leg','prenota','chi-siamo','contatti']){
  const page=fs.readFileSync(path.join(root,route,'index.html'),'utf8');assert.deepEqual(scripts(page),scripts(html));
  assert.ok(page.includes('id="customer-passengers-list"'));
  assert.ok(page.includes(`href="https://auralisair.it/${route}/"`));
 }
});
test('past confirmed booking is displayed as completed',()=>{
 const c=vm.createContext({Date});vm.runInContext(fn('getBookingDeparture'),c);vm.runInContext(fn('normaliseBookingStatus'),c);
 assert.equal(c.normaliseBookingStatus({status:'CONFIRMED',emptyLeg:{departureAt:'2020-01-01T00:00:00Z'}}),'completed');
});
test('pending refund never becomes REFUNDED; retry observes succeeded refund',async()=>{
 const payment={id:'p1',status:'PAID',stripePaymentIntentId:'pi_1',payerEmail:'payer@example.test'};let refundStatus='pending';const keys=[];
 const db={auditLog:auditStore(),booking:{findUnique:async()=>({bookingType:'SPLIT',payments:[payment]})},bookingPayment:{update:async({data})=>Object.assign(payment,data)}};
 const c=vm.createContext({Date,Error,Set,env:{},logger:{info(){},warn(){}},PrismaPg:class{},PrismaClient:class{constructor(){return db}},
 Stripe:class{constructor(){return{refunds:{create:async(_data,options)=>{keys.push(options.idempotencyKey);return{id:'re1',status:'pending'}},retrieve:async()=>({id:'re1',status:refundStatus})}}}}});
 loadTS('backend/src/services/payments.service.ts',c);
 await assert.rejects(()=>c.refundBookingPayments('b1'));assert.equal(payment.status,'PAID');
 refundStatus='succeeded';await c.refundBookingPayments('b1');assert.equal(payment.status,'REFUNDED');assert.equal(keys[0],keys[1]);
});
test('consent blocks Google before opt-in and disables loaded tag on revocation',()=>{
 const listeners={};const store=new Map();const scripts=[];const nodes={};
 const body={style:{},insertAdjacentHTML(){},addEventListener:(name,fn)=>listeners['body:'+name]=fn};
 const c=vm.createContext({Date,JSON,Set,encodeURIComponent,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},
 document:{cookie:'',head:{appendChild:n=>{if(n.src)scripts.push(n)}},body,getElementById:id=>nodes[id]||null,querySelector:()=>null,
 createElement:()=>({dataset:{}}),addEventListener:(name,fn)=>listeners[name]=fn},
 location:{origin:'https://auralisair.it',pathname:'/',href:'https://auralisair.it/?code=secret&state=private'},clearTimeout(){},setTimeout(){}});
 c.window=c;vm.runInContext(fs.readFileSync(path.join(root,'assets/auralis-consent.js'),'utf8'),c);
 assert.equal(scripts.length,0);listeners.DOMContentLoaded();
 const click=action=>listeners['body:click']({target:{closest:()=>({dataset:{acAction:action}})}});
 click('accept');assert.equal(scripts.length,1);assert.equal(c['ga-disable-G-Z1EXTLD4JV'],false);
 c.auralisTrack('login');const event=[...c.dataLayer].find(args=>args[0]==='event'&&args[1]==='login');assert.equal(event[2].page_location,'https://auralisair.it/');
 click('reject');assert.equal(c['ga-disable-G-Z1EXTLD4JV'],true);const count=c.dataLayer.length;c.auralisTrack('login');assert.equal(c.dataLayer.length,count);
});

test('failed payment email retries without resending accepted operator email',async()=>{
 const f=fixture('PAID');let attempts=0;
 f.context.sendPaymentConfirmedEmail=async()=>++attempts>1;
 await assert.rejects(()=>f.context.ensureBookingNotifications(f.db,'b1'));
 await f.context.ensureBookingNotifications(f.db,'b1');
 await f.context.ensureBookingNotifications(f.db,'b1');
 assert.equal(attempts,2);assert.deepEqual(f.notifications,['operator']);
});
test('concurrent email claims send once; stale sending lease recovers',async()=>{
 const f=fixture();let sends=0;
 const send=async()=>{sends++;return true};
 await Promise.all([f.context.sendBookingEmailOnce(f.db,'b1','x',send),f.context.sendBookingEmailOnce(f.db,'b1','x',send)]);
 assert.equal(sends,1);
 await f.db.auditLog.upsert({where:{id:'email:b1:stale'},create:{id:'email:b1:stale',action:'BOOKING_EMAIL_SENDING',createdAt:new Date(0)},update:{}});
 await f.context.sendBookingEmailOnce(f.db,'b1','stale',send);assert.equal(sends,2);
});
function reconciliationFixture(status,sessionOverrides={}) {
 const f=fixture(status);
 f.context.ensureSplitInvitations=async()=>({failed:0});
 loadTS('backend/src/services/bookingState.service.ts',f.context);
 loadTS('backend/src/services/paymentReconciliation.service.ts',f.context);
 const stripe={checkout:{sessions:{retrieve:async id=>{
  const p=f.payments.find(p=>p.stripeCheckoutSessionId===id);
  return {id,status:'open',payment_status:'unpaid',metadata:{bookingId:'b1',bookingPaymentId:p.id},payment_intent:'pi_'+p.id,amount_total:5000,currency:'eur',...sessionOverrides};
 }}}};
 f.run=()=>f.context.reconcileBooking(f.db,stripe,'b1');return f;
}
test('reconciliation recovers both missed payment webhooks',async()=>{
 const f=reconciliationFixture('PENDING_PAYMENT',{status:'complete',payment_status:'paid'});
 await f.run();assert.equal(f.booking.status,'PAID');assert.equal(f.notifications.length,2);
 await f.run();assert.equal(f.notifications.length,2);
});
test('reconciliation does not prematurely close open or processing sessions',async()=>{
 const open=reconciliationFixture('PENDING_PAYMENT');await open.run();assert.equal(open.booking.status,'PENDING_PAYMENT');
 const processing=reconciliationFixture('PENDING_PAYMENT',{status:'complete'});processing.booking.splitExpiresAt=new Date(0);
 await processing.run();assert.equal(processing.booking.status,'PENDING_PAYMENT');
});
test('reconciliation closes expired split and attempts refund despite cleanup failure',async()=>{
 const f=reconciliationFixture('PENDING_PAYMENT',{status:'expired'});
 f.context.expirePendingCheckoutSessions=async()=>{throw Error('temporary Stripe error')};
 await assert.rejects(f.run);assert.equal(f.booking.status,'EXPIRED');assert.deepEqual(f.refunds,['b1']);
});
test('reconciliation closes orphan but preserves confirmed booking after departure',async()=>{
 const orphan=reconciliationFixture('PENDING_PAYMENT');orphan.payments.forEach(p=>p.stripeCheckoutSessionId=null);
 await orphan.run();assert.equal(orphan.booking.status,'EXPIRED');
 const confirmed=reconciliationFixture('CONFIRMED');confirmed.booking.emptyLeg.departureAt=new Date(0);
 await confirmed.run();assert.equal(confirmed.booking.status,'CONFIRMED');assert.equal(confirmed.refunds.length,0);
});
test('paid-only cancellation guard preserves concurrently confirmed booking',async()=>{
 const f=reconciliationFixture('CONFIRMED');
 assert.equal(await f.context.closeBooking(f.db,'b1','CANCELLED',false,'PAID'),null);
 assert.equal(f.booking.status,'CONFIRMED');
});
test('identity requires verified email and matching subject, isolates token cache',async()=>{
 let calls=0;let profile={sub:'auth0|1',email:'  Verified@Example.test ',email_verified:true};
 const c=vm.createContext({URL,AbortSignal,createHash:require('node:crypto').createHash,randomUUID:require('node:crypto').randomUUID,env:{auth0IssuerBaseUrl:'https://identity.example.test'},fetch:async()=>{calls++;return{ok:true,json:async()=>profile}}});
 loadTS('backend/src/services/identity.service.ts',c);
 const get=(token,sub='auth0|1')=>c.verifiedIdentityEmail('Bearer '+token,sub);
 assert.deepEqual(await Promise.all([get('a'),get('a')]),['verified@example.test','verified@example.test']);assert.equal(calls,1);
 assert.equal(await get('a','auth0|2'),null);
 profile={...profile,email_verified:false};assert.equal(await get('b'),null);
 profile={...profile,email_verified:'true'};assert.equal(await get('c'),null);
 assert.equal(await c.verifiedIdentityEmail('', 'auth0|1'),null);
});
test('email escapes user content, rejects unsafe links and reports provider failure',async()=>{
 const sent=[];let providerError=null;
 const c=vm.createContext({URL,createHash:require('node:crypto').createHash,randomUUID:require('node:crypto').randomUUID,env:{resendApiKey:'test',emailFrom:'team@example.test'},logger:{info(){},error(){},warn(){}},Resend:class{constructor(){return{emails:{send:async(payload,options)=>{sent.push({payload,options});return{data:{id:'m1'},error:providerError}}}}}}});
 loadTS('backend/src/utils/emailSafety.ts',c);loadTS('backend/src/services/email.service.ts',c);
 assert.equal(c.escapeEmailText('<b>O\'Brien</b>'),'&lt;b&gt;O&#39;Brien&lt;/b&gt;');
 assert.throws(()=>c.emailLink('javascript:alert(1)'));
 const data={deliveryKey:'email:b1:paid-customer',to:'test@example.test',bookerFirstName:'<img src=x onerror=alert(1)>',fromAirport:'LIN',toAirport:'GVA'};
 assert.equal(await c.sendPaymentConfirmedEmail(data),true);
 assert.ok(!sent[0].payload.html.includes('<img src=x'));
 await c.sendPaymentConfirmedEmail(data);assert.equal(sent[0].options.idempotencyKey,sent[1].options.idempotencyKey);
 await c.sendPaymentConfirmedEmail({...data,deliveryKey:'email:b2:paid-customer'});assert.notEqual(sent[0].options.idempotencyKey,sent[2].options.idempotencyKey);
 providerError={message:'rejected'};assert.equal(await c.sendPaymentConfirmedEmail(data),false);
});
test('split invitations never distribute a partially created checkout set',async()=>{
 const f=fixture();f.booking.passengers=[{id:'a'},{id:'b'}];f.payments[1].stripeCheckoutSessionId=null;
 loadTS('backend/src/services/splitInvitations.service.ts',f.context);
 const result=await f.context.ensureSplitInvitations(f.db,{checkout:{sessions:{retrieve:async()=>{throw Error('must not retrieve')}}}},'b1');
 assert.equal(result.failed,1);
});

test('pre-launch UX removes unverified promises and keeps one hero CTA',()=>{
 const hero=(html.match(/<section class="clarity-hero">[\s\S]*?<\/section>/)||[''])[0];
 assert.ok(hero.includes('Scopri i Voli Disponibili'));
 assert.ok(!hero.includes('Come Funziona'));
 assert.ok(!html.includes('oltre il 40%'));
 assert.ok(!html.includes('fino al 75%'));
 assert.ok(!html.includes('entro 2 ore'));
 assert.ok(!html.includes('24 ore su 24, 7 giorni su 7'));
});

test('booking UX explains split payment and operational confirmation',()=>{
 assert.ok(html.includes('Dividi il pagamento tra i passeggeri'));
 assert.ok(html.includes('ognuno paga la propria quota'));
 assert.ok(html.includes('Pagamento separato'));
 assert.ok(html.includes('Il pagamento non equivale ancora alla conferma operativa del volo'));
 assert.ok(html.includes('Il volo selezionato resterà salvato'));
});

test('empty-leg UX provides persistent filters and recovery actions',()=>{
 assert.ok(html.includes("const EMPTY_LEG_FILTER_KEY='auralisEmptyLegFilters'"));
 assert.ok(html.includes('id="el-filter-empty"'));
 assert.ok(html.includes('Nessun Empty Leg corrisponde esattamente alla tua ricerca'));
 assert.ok(html.includes('id="flight-request-section"'));
 assert.ok(!html.includes("getElementById('custom-request-section')"));
});
