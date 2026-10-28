import { env } from 'cloudflare:workers';
import { evaluateRoster, validateRow, outcome, maskApaar, categories, dateValue, type Institution, type Programme, type Student, type Batch, type Snapshot, type AuditEvent, type ReportRow, type Review, type Finding } from './domain';

type Data = {institutions:Institution[]; programmes:Programme[]; students:Student[]; batches:Batch[]; audit:AuditEvent[];reviews:Review[]};
export class InputError extends Error { constructor(message:string, public status=400,public findings?:unknown){super(message);} }
function database(){const db=(env as {DB?:D1Database}).DB;if(!db)throw new Error('The workspace database is unavailable.');return db;}
const now=()=>new Date().toISOString();
const text=(v:unknown,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const uuid=()=>crypto.randomUUID();
function integer(v:unknown,label:string){const n=Number(v);if(!Number.isInteger(n)||n<0||n>10000)throw new InputError(label+' must be a whole number between 0 and 10,000.');return n;}
async function key(value:string){if(!value)return null;const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function dataFor(owner:string):Promise<Data>{
 const db=database();const names=['institutions','programmes','students','batches','reviews'] as const;
 const results=await Promise.all(names.map(table=>db.prepare(`SELECT payload FROM ${table} WHERE owner_id = ?`).bind(owner).all<{payload:string}>()));
 const rows=results.map(r=>r.results.map(v=>JSON.parse(v.payload)));
 const events=await db.prepare('SELECT id,actor,action,entity_id AS entityId,detail,timestamp FROM audit_events WHERE owner_id = ? ORDER BY timestamp DESC LIMIT 500').bind(owner).all<AuditEvent>();
 return {institutions:rows[0],programmes:rows[1],students:rows[2],batches:rows[3].sort((a:Batch,b:Batch)=>b.createdAt.localeCompare(a.createdAt)),audit:events.results,reviews:rows[4].sort((a:Review,b:Review)=>b.createdAt.localeCompare(a.createdAt))};
}
async function findingFingerprint(student:Student,finding:Finding,data:Data,evaluation:ReturnType<typeof evaluateRoster>){const related=new Set(evaluation.collisions.filter(c=>c.studentId===student.id||c.otherId===student.id).flatMap(c=>[c.studentId,c.otherId]));return (await key(JSON.stringify({student,finding,programme:data.programmes.find(p=>p.id===student.programmeId),related:data.students.filter(s=>related.has(s.id)).sort((a,b)=>a.id.localeCompare(b.id))})))!;}
async function clearedFindings(student:Student,data:Data,evaluation:ReturnType<typeof evaluateRoster>){const cleared:string[]=[];for(const finding of evaluation.findings.get(student.id)||[]){if(finding.rule!=='V-05')continue;const fingerprint=await findingFingerprint(student,finding,data,evaluation),review=data.reviews.find(r=>r.studentId===student.id&&r.rule===finding.rule&&r.fingerprint===fingerprint);if(review?.decision==='CLEARED')cleared.push(finding.rule);}return cleared;}
export async function snapshot(owner:string,user:string):Promise<Snapshot>{
 const data=await dataFor(owner),evaluation=evaluateRoster(data.students,data.programmes);
 const safeStudents=await Promise.all(data.students.map(async s=>{const {apaar,...safe}=s;const findings=evaluation.findings.get(s.id)!,cleared=await clearedFindings(s,data,evaluation);return {...safe,apaarMasked:maskApaar(apaar),findings,clearedFindings:cleared,reviews:data.reviews.filter(r=>r.studentId===s.id).map(({fingerprint,...r})=>({...r,fingerprint:''})),outcome:outcome(findings.filter(f=>!cleared.includes(f.rule)))};}));
 const {reviews,...rest}=data;
 return {...rest,user,students:safeStudents,collisions:evaluation.collisions.filter(c=>[c.studentId,c.otherId].some(id=>!safeStudents.find(s=>s.id===id)?.clearedFindings.includes('V-05'))),programmeFindings:evaluation.programmeFindings};
}
function auditStatement(owner:string,actor:string,action:string,entityId:string,detail:string){return database().prepare('INSERT INTO audit_events (id,owner_id,actor,action,entity_id,detail,timestamp) VALUES (?,?,?,?,?,?,?)').bind(uuid(),owner,actor,action,entityId,detail,now());}
function putInstitution(owner:string,i:Institution,update=false){return update?database().prepare('UPDATE institutions SET code=?,payload=? WHERE id=? AND owner_id=?').bind(i.code,JSON.stringify(i),i.id,owner):database().prepare('INSERT INTO institutions (id,owner_id,code,payload) VALUES (?,?,?,?)').bind(i.id,owner,i.code,JSON.stringify(i));}
function putProgramme(owner:string,p:Programme,update=false){return update?database().prepare('UPDATE programmes SET name=?,payload=? WHERE id=? AND owner_id=?').bind(p.name,JSON.stringify(p),p.id,owner):database().prepare('INSERT INTO programmes (id,owner_id,institution_id,name,payload) VALUES (?,?,?,?,?)').bind(p.id,owner,p.institutionId,p.name,JSON.stringify(p));}
async function putStudent(owner:string,s:Student,update=false){const hash=await key(s.apaar);return update?database().prepare('UPDATE students SET institution_id=?,programme_id=?,apaar_key=?,payload=? WHERE id=? AND owner_id=?').bind(s.institutionId,s.programmeId,hash,JSON.stringify(s),s.id,owner):database().prepare('INSERT INTO students (id,owner_id,institution_id,programme_id,apaar_key,payload) VALUES (?,?,?,?,?,?)').bind(s.id,owner,s.institutionId,s.programmeId,hash,JSON.stringify(s));}
async function putStudents(owner:string,students:Student[]){const rows=await Promise.all(students.map(async s=>({id:s.id,institutionId:s.institutionId,programmeId:s.programmeId,apaarKey:await key(s.apaar),payload:s})));return database().prepare("INSERT INTO students (id,owner_id,institution_id,programme_id,apaar_key,payload) SELECT json_extract(value,'$.id'),?,json_extract(value,'$.institutionId'),json_extract(value,'$.programmeId'),json_extract(value,'$.apaarKey'),json_extract(value,'$.payload') FROM json_each(?)").bind(owner,JSON.stringify(rows));}
function institutionInput(input:Record<string,unknown>,old?:Institution):Institution{const name=text(input.name),code=text(input.code,40).toUpperCase();if(!name||!code)throw new InputError('Institution name and code are required.');if(!/^[A-Z0-9_-]+$/.test(code))throw new InputError('Institution code may contain letters, numbers, underscores and hyphens.');return {id:old?.id||uuid(),name,code,city:text(input.city),type:text(input.type)||'Engineering institution',createdAt:old?.createdAt||now()};}
function programmeInput(input:Record<string,unknown>,institutionId:string,old?:Programme):Programme{const name=text(input.name);if(!name)throw new InputError('Programme name is required.');const quotas:Record<string,number>={};const values=input.quotas&&typeof input.quotas==='object'?input.quotas as Record<string,unknown>:{};for(const category of categories.filter(c=>!['Regular','Management'].includes(c)))quotas[category]=integer(values[category]??0,category+' ceiling');const windowStart=text(input.windowStart,10),windowEnd=text(input.windowEnd,10);if((windowStart&&dateValue(windowStart)===null)||(windowEnd&&dateValue(windowEnd)===null)||(windowStart&&windowEnd&&windowStart>windowEnd))throw new InputError('Provide a valid admission window.');return {id:old?.id||uuid(),institutionId,name,level:text(input.level)||'Undergraduate',intake:integer(input.intake,'Regular intake'),quotas,windowStart,windowEnd};}
function studentInput(input:Record<string,unknown>,old?:Student):Student{return {id:old?.id||uuid(),institutionId:text(input.institutionId),programmeId:text(input.programmeId),name:text(input.name),dob:text(input.dob,10),apaar:input.apaar===undefined?(old?.apaar||''):text(input.apaar,40),email:text(input.email),category:text(input.category),seatType:text(input.seatType)||'regular',admissionDate:text(input.admissionDate,10),endDate:text(input.endDate,10),releaseVerified:input.releaseVerified===true,status:text(input.status)||'Active',createdAt:old?.createdAt||now(),...(old?.batchId?{batchId:old.batchId}:{})};}
function selectedInstitution(data:Data,id:string){const i=data.institutions.find(i=>i.id===id);if(!i)throw new InputError('Select an institution in your workspace.',404);return i;}
function normalizeRows(rows:unknown,data:Data,institution:Institution,batchId:string){
 if(!Array.isArray(rows)||!rows.length||rows.length>2000)throw new InputError('Provide between 1 and 2,000 student rows.');
 return rows.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new InputError('Invalid student row '+(index+2));const row=raw as Record<string,unknown>;
  const read=(...names:string[])=>{for(const name of names)if(row[name]!==undefined)return text(row[name],250);return '';};
  const programmeName=read('programme','program','programme_name','program_name','course');
  const programme=data.programmes.find(p=>p.institutionId===institution.id&&(p.id===read('programme_id')||p.name.toLowerCase()===programmeName.toLowerCase()));
  const category=read('category','seat_category');
  const s=studentInput({institutionId:institution.id,programmeId:programme?.id||'',name:read('name','student_name','full_name'),dob:read('dob','date_of_birth'),apaar:read('apaar','apaar_id','apaar_identifier'),email:read('email'),category,seatType:read('seat_type')||(['Regular','Management'].includes(category)?'regular':'supernumerary'),admissionDate:read('admission_date','admission'),endDate:read('end_date','release_date'),releaseVerified:['true','yes','1'].includes(read('release_verified').toLowerCase()),status:read('status')||'Active'});
  s.batchId=batchId;
  const code=read('institution_code'),id=read('institution_id');
  const mismatch=(code&&code.toUpperCase()!==institution.code)||(id&&id!==institution.id);
  return {student:s,programmeName,sourceRow:index+2,mismatch:Boolean(mismatch)};
 });
}
function reportFor(data:Data,rows:ReturnType<typeof normalizeRows>){const evaluation=evaluateRoster([...data.students,...rows.filter(r=>!r.mismatch).map(r=>r.student)],data.programmes,rows.map(r=>r.student.id));return rows.map(r=>{const findings=evaluation.findings.get(r.student.id)||validateRow(r.student,data.programmes.find(p=>p.id===r.student.programmeId));if(r.mismatch)findings.unshift({rule:'IMPORT',severity:'BLOCKING',title:'Institution mismatch',detail:'The CSV institution does not match the selected institution.'});return {row:r.sourceRow,name:r.student.name||'Unnamed row',apaarMasked:maskApaar(r.student.apaar),programme:r.programmeName||data.programmes.find(p=>p.id===r.student.programmeId)?.name||'Unknown programme',outcome:outcome(findings),findings} as ReportRow;});}
function reportCounts(rows:ReportRow[]){return {accepted:rows.filter(r=>r.outcome==='ACCEPTED').length,flagged:rows.filter(r=>r.outcome==='FLAGGED').length,rejected:rows.filter(r=>r.outcome==='REJECTED').length};}
export async function execute(owner:string,actor:string,input:Record<string,unknown>){
 const action=text(input.action),data=await dataFor(owner);const db=database();
 if(action==='institution.save'){
  const old=input.id?data.institutions.find(i=>i.id===input.id):undefined;if(input.id&&!old)throw new InputError('Institution not found.',404);
  const institution=institutionInput(input,old);if(data.institutions.some(i=>i.code===institution.code&&i.id!==institution.id))throw new InputError('An institution with this code already exists.',409);
  await db.batch([putInstitution(owner,institution,Boolean(old)),auditStatement(owner,actor,old?'INSTITUTION_UPDATED':'INSTITUTION_CREATED',institution.id,institution.name+' · '+institution.code)]);
 }else if(action==='programme.save'){
  const institution=selectedInstitution(data,text(input.institutionId));const old=input.id?data.programmes.find(p=>p.id===input.id&&p.institutionId===institution.id):undefined;if(input.id&&!old)throw new InputError('Programme not found.',404);
  const programme=programmeInput(input,institution.id,old);if(data.programmes.some(p=>p.institutionId===institution.id&&p.name.toLowerCase()===programme.name.toLowerCase()&&p.id!==programme.id))throw new InputError('That programme already exists in this institution.',409);
  await db.batch([putProgramme(owner,programme,Boolean(old)),auditStatement(owner,actor,old?'PROGRAMME_UPDATED':'PROGRAMME_CREATED',programme.id,programme.name+' · regular intake '+programme.intake)]);
 }else if(action==='student.save'){
  const old=input.id?data.students.find(s=>s.id===input.id):undefined;if(input.id&&!old)throw new InputError('Student record not found.',404);
  const student=studentInput(input,old);selectedInstitution(data,student.institutionId);const findings=validateRow(student,data.programmes.find(p=>p.id===student.programmeId));
  if(outcome(findings)==='REJECTED'){await db.batch([auditStatement(owner,actor,'STUDENT_VALIDATION_REJECTED',student.id,findings.map(f=>f.rule+': '+f.title).join('; '))]);throw new InputError('Correct the blocking findings before saving.',422,findings);}
  await db.batch([await putStudent(owner,student,Boolean(old)),auditStatement(owner,actor,old?'STUDENT_UPDATED':'STUDENT_CREATED',student.id,student.name+' · '+student.status)]);
 }else if(action==='import.preview'||action==='import.commit'){
  const institution=selectedInstitution(data,text(input.institutionId));if(!data.programmes.some(p=>p.institutionId===institution.id))throw new InputError('Add an approved programme before importing students.');
  const batchId=text(input.batchId,80)||uuid();if(!/^[a-zA-Z0-9_-]{8,80}$/.test(batchId))throw new InputError('Invalid batch reference.');
  const existing=data.batches.find(b=>b.id===batchId);if(existing&&action==='import.commit')return {state:await snapshot(owner,actor),batch:existing};
  const rows=normalizeRows(input.rows,data,institution,batchId),report=reportFor(data,rows),counts=reportCounts(report);
  if(action==='import.preview')return {preview:{id:batchId,institutionId:institution.id,filename:text(input.filename)||'students.csv',createdAt:now(),...counts,rows:report}};
  const batch:Batch={id:batchId,institutionId:institution.id,filename:text(input.filename)||'students.csv',createdAt:now(),...counts,rows:report};
  const acceptedRows=rows.filter((_,i)=>report[i].outcome!=='REJECTED').map(r=>r.student);const statements:D1PreparedStatement[]=acceptedRows.length?[await putStudents(owner,acceptedRows)]:[];
  statements.push(db.prepare('INSERT INTO batches (id,owner_id,institution_id,payload) VALUES (?,?,?,?)').bind(batch.id,owner,institution.id,JSON.stringify(batch)),auditStatement(owner,actor,'BATCH_IMPORTED',batch.id,`${batch.filename}: ${counts.accepted} accepted, ${counts.flagged} flagged, ${counts.rejected} rejected. Institution: ${institution.code}.`));
  await db.batch(statements);return {state:await snapshot(owner,actor),batch};
 }else if(action==='review'){
  const student=data.students.find(s=>s.id===input.studentId);if(!student)throw new InputError('Student record not found.',404);
  const rule=text(input.rule,20),decision=text(input.decision,30) as Review['decision'],reason=text(input.reason,2000);
  const evaluation=evaluateRoster(data.students,data.programmes),finding=evaluation.findings.get(student.id)?.find(f=>f.rule===rule);if(!finding)throw new InputError('This finding is no longer present. Refresh the record.',409);
  if(!['CLEARED','CONFIRMED','NEEDS_EVIDENCE'].includes(decision))throw new InputError('Choose a review decision.');if(reason.length<12)throw new InputError('Provide a review rationale of at least 12 characters.');if(decision==='CLEARED'&&rule!=='V-05')throw new InputError('Statutory findings must be corrected in the record or programme configuration. Only potential identity collisions can be cleared by review.');
  const review:Review={id:uuid(),studentId:student.id,rule,decision,reason,fingerprint:await findingFingerprint(student,finding,data,evaluation),actor,createdAt:now()};
  await db.batch([db.prepare('INSERT INTO reviews (id,owner_id,student_id,payload) VALUES (?,?,?,?)').bind(review.id,owner,student.id,JSON.stringify(review)),auditStatement(owner,actor,'FINDING_ADJUDICATED',student.id,`${rule} · ${decision} · ${reason}`)]);
 }else if(action==='verify'){
  const apaar=text(input.apaar,40);if(!/^\d{12}$/.test(apaar))throw new InputError('Enter a 12-digit APAAR identifier.');
  const matches=data.students.filter(s=>s.apaar===apaar),evaluation=evaluateRoster(data.students,data.programmes);
  const active=matches.filter(s=>s.status==='Active'),candidate=active.length===1?active[0]:matches.length===1?matches[0]:undefined;
  const pending=(await Promise.all(matches.map(async s=>{const cleared=await clearedFindings(s,data,evaluation);return outcome(evaluation.findings.get(s.id)!.filter(f=>!cleared.includes(f.rule)))!=='ACCEPTED';}))).some(Boolean);
  const status=matches.length===0?'NOT_VERIFIED':!candidate||pending?'UNABLE_TO_VERIFY':'VERIFIED';
  await db.batch([auditStatement(owner,actor,'VERIFICATION_QUERY',candidate?.id||'lookup',maskApaar(apaar)+' · '+status+' · sandbox adapter')]);
  const verification={status,identifier:maskApaar(apaar),adapter:'Sandbox · local workspace records',checkedAt:now(),explanation:status==='VERIFIED'?'A matching record passes the workspace checks. This is a sandbox response, not an official APAAR registry attestation.':status==='NOT_VERIFIED'?'No matching record exists in this workspace. This does not establish whether an official APAAR record exists.':'Matching records have unresolved findings or ambiguous enrolments. Resolve the review items before verifying.',records:matches.map(s=>({id:s.id,name:s.name,institution:data.institutions.find(i=>i.id===s.institutionId)?.name,programme:data.programmes.find(p=>p.id===s.programmeId)?.name,status:s.status,admissionDate:s.admissionDate,findings:evaluation.findings.get(s.id)}))};
  return {verification,state:await snapshot(owner,actor)};
 }else if(action==='export'){
  await db.batch([auditStatement(owner,actor,'DATA_EXPORTED',text(input.kind)||'students','Downloaded '+(text(input.kind)||'students')+' report with masked identifiers.')]);
 }else if(action==='seed'){
  if(data.institutions.length||data.students.length)throw new InputError('Sample data can only be loaded into an empty workspace.',409);
  const seed=sampleData();const statements:D1PreparedStatement[]=[...seed.institutions.map(i=>putInstitution(owner,i)),...seed.programmes.map(p=>putProgramme(owner,p)),await putStudents(owner,seed.students),auditStatement(owner,actor,'SAMPLE_DATA_LOADED','workspace','Loaded synthetic institutions, programmes and student records.')];await db.batch(statements);
 }else throw new InputError('Unknown workspace action.');
 return {state:await snapshot(owner,actor)};
}
function sampleData(){
 const institutions:Institution[]=[['NIT Delhi','NITD','New Delhi','National institute'],['NIT Tiruchirappalli','NITT','Tiruchirappalli','National institute'],['PES University','PES','Bengaluru','University']].map(([name,code,city,type])=>({id:uuid(),name,code,city,type,createdAt:now()}));
 const programmes:Programme[]=institutions.flatMap((i,index)=>[{id:uuid(),institutionId:i.id,name:'Computer Science',level:'Undergraduate',intake:index===0?12:24,quotas:{TFW:1,NRI:3,EWS:3,'Lateral Entry':3,PMSSS:2,'J&K':2},windowStart:'2025-06-01',windowEnd:'2026-11-30'},...(index===1?[{id:uuid(),institutionId:i.id,name:'Electrical Engineering',level:'Undergraduate',intake:18,quotas:{TFW:1,NRI:2,EWS:2,'Lateral Entry':2,PMSSS:1,'J&K':1},windowStart:'2025-06-01',windowEnd:'2026-11-30'}]:[])]);
 const names=['Aarav Mehta','Diya Shah','Kabir Nair','Ananya Rao','Arjun Kumar','Isha Patel','Rohan Das','Meera Iyer','Aditya Sen','Sana Ali','Vivaan Joshi','Tara Kapoor','Dev Verma','Nila Menon','Krish Malhotra','Avni Desai'];
 const students:Student[]=[];
 for(let group=0;group<3;group++)for(let j=0;j<(group===0?16:8);j++){const institution=institutions[group],programme=programmes.find(p=>p.institutionId===institution.id)!;const s:Student={id:uuid(),institutionId:institution.id,programmeId:programme.id,name:names[(j+group*3)%names.length],dob:`2006-${String(j%9+1).padStart(2,'0')}-12`,apaar:String(600000000001+group*100+j),email:'',category:group===0&&j>=14?'TFW':'Regular',seatType:group===0&&j>=14?'supernumerary':'regular',admissionDate:'2025-08-12',endDate:'',releaseVerified:false,status:'Active',createdAt:now()};if(group===1&&j===0){s.name=students[0].name;s.dob=students[0].dob;s.apaar=students[0].apaar;}if(group===2&&j===2)s.apaar='';students.push(s);}
 return {institutions,programmes,students};
}
