globalThis.window = {}; globalThis.innerWidth=1000; globalThis.innerHeight=800;
const { isJunkName } = await import('/Users/andersbj/Projekt/chat-chattaren/src/anchor.js');
const junk = ['css-1x2y3z','sc-bdVaJa','jsx-2913712927',':r1:',':r2h:','makeStyles-root-123',
  'Button_root__x7Fq2','_1a2b3c4','e1x2y3z0','3f2b1a9c-1234-5678-9abc-def012345678',
  'a1b2c3d4e5f6a7b8','emotion-cache-1abc','tw-9f8e7d','ember1234','ng-tns-c12-3'];
const good = ['chat-input','messageList','composer','intercom-composer','send-button',
  'zd-chat-input','conversation','btn-primary','message-bubble','input','textarea','fake-console'];
let fail=0;
for (const n of junk) if (!isJunkName(n)) { console.log('MISS junk:', n); fail++; }
for (const n of good) if (isJunkName(n)) { console.log('FALSE POSITIVE good:', n); fail++; }
console.log(fail ? `\n${fail} fel` : '\nAlla klassnamn korrekt klassade');
