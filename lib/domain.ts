export const categories = ['Regular','Management','TFW','NRI','EWS','Lateral Entry','PMSSS','J&K'] as const;
export type Outcome = 'ACCEPTED' | 'FLAGGED' | 'REJECTED';
export type Finding = {rule:string; severity:'BLOCKING'|'WARNING'|'INFO'; title:string; detail:string};
export type Institution = {id:string; name:string; code:string; city:string; type:string; createdAt:string};
export type Programme = {id:string; institutionId:string; name:string; level:string; intake:number; quotas:Record<string,number>; windowStart:string; windowEnd:string};
export type Student = {id:string; institutionId:string; programmeId:string; name:string; dob:string; apaar:string; email:string; category:string; seatType:string; admissionDate:string; endDate:string; releaseVerified:boolean; status:string; createdAt:string; batchId?:string};
export type Review = {id:string;studentId:string;rule:string;decision:'CLEARED'|'CONFIRMED'|'NEEDS_EVIDENCE';reason:string;fingerprint:string;actor:string;createdAt:string};
export type StudentView = Omit<Student,'apaar'> & {apaarMasked:string; outcome:Outcome; findings:Finding[];clearedFindings:string[];reviews:Review[]};
export type Collision = {studentId:string; otherId:string; method:string; score:number; detail:string};
export type ReportRow = {row:number; name:string; apaarMasked:string; programme:string; outcome:Outcome; findings:Finding[]};
export type Batch = {id:string; institutionId:string; filename:string; createdAt:string; accepted:number; flagged:number; rejected:number; rows:ReportRow[]};
export type AuditEvent = {id:string; actor:string; action:string; entityId:string; detail:string; timestamp:string};
export type Snapshot = {institutions:Institution[]; programmes:Programme[]; students:StudentView[]; batches:Batch[]; audit:AuditEvent[]; collisions:Collision[]; programmeFindings:{programmeId:string;finding:Finding}[]; user:string};
export function dateValue(value:string):number|null {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const [y,m,d]=value.split('-').map(Number); const time=Date.UTC(y,m-1,d), date=new Date(time);
 return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?time:null;
}
export function ageAt(dob:string,at:string){const d=new Date(dob+'T00:00:00Z'),a=new Date(at+'T00:00:00Z');let age=a.getUTCFullYear()-d.getUTCFullYear();if(a.getUTCMonth()<d.getUTCMonth()||(a.getUTCMonth()===d.getUTCMonth()&&a.getUTCDate()<d.getUTCDate()))age--;return age;}
export function maskApaar(value:string){return value?'APAAR-***-'+value.slice(-4):'Not provided';}
export function outcome(findings:Finding[]):Outcome{return findings.some(f=>f.severity==='BLOCKING')?'REJECTED':findings.length?'FLAGGED':'ACCEPTED';}
export function bigramSimilarity(a:string,b:string){
 const clean=(s:string)=>s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g,'');a=clean(a);b=clean(b);if(a===b&&a)return 1;if(a.length<2||b.length<2)return 0;
 const grams=new Map<string,number>();for(let i=0;i<a.length-1;i++){const k=a.slice(i,i+2);grams.set(k,(grams.get(k)||0)+1);}let common=0;for(let i=0;i<b.length-1;i++){const k=b.slice(i,i+2),n=grams.get(k)||0;if(n){common++;grams.set(k,n-1);}}return 2*common/(a.length+b.length-2);
}
export function overlaps(a:Student,b:Student){const as=dateValue(a.admissionDate),bs=dateValue(b.admissionDate);if(as===null||bs===null)return false;const ae=a.endDate?dateValue(a.endDate):Infinity,be=b.endDate?dateValue(b.endDate):Infinity;return ae!==null&&be!==null&&as<=be&&bs<=ae;}
export function validateRow(s:Student,programme?:Programme):Finding[]{
 const findings:Finding[]=[];const add=(rule:string,title:string,detail:string,severity:Finding['severity']='WARNING')=>findings.push({rule,title,detail,severity});
 if(!s.name.trim()||!s.dob||!s.programmeId||!s.category||!s.admissionDate)add('V-01','Required fields missing','Provide name, DOB, programme, category and admission date.','BLOCKING');
 if(!programme||programme.institutionId!==s.institutionId)add('IMPORT','Programme does not belong to selected institution','Choose an approved programme for this institution.','BLOCKING');
 if(!s.apaar)add('V-02','APAAR ID missing','The row remains in intake accounting; obtain the identifier when available.');
 else if(!/^\d{12}$/.test(s.apaar))add('V-03','APAAR format mismatch','Expected exactly 12 numeric digits. Format checks do not verify an identity.');
 const dob=dateValue(s.dob),admission=dateValue(s.admissionDate),end=s.endDate?dateValue(s.endDate):null;
 if((s.dob&&dob===null)||(s.admissionDate&&admission===null)||(dob!==null&&admission!==null&&(ageAt(s.dob,s.admissionDate)<14||ageAt(s.dob,s.admissionDate)>70))||(s.endDate&&(end===null||(admission!==null&&end<admission))))add('V-06','Invalid age or chronology','Use valid dates, age 14–70 at admission, and a release date on or after admission.','BLOCKING');
 if(programme&&admission!==null&&((programme.windowStart&&s.admissionDate<programme.windowStart)||(programme.windowEnd&&s.admissionDate>programme.windowEnd)))add('V-07','Admission outside configured window',`Configured window: ${programme.windowStart||'open'} to ${programme.windowEnd||'open'}.`);
 if(!categories.includes(s.category as typeof categories[number])||!['regular','supernumerary'].includes(s.seatType)||(s.seatType==='regular'&&!['Regular','Management'].includes(s.category))||(s.seatType==='supernumerary'&&s.category==='Regular'))add('V-08','Seat category conflicts with quota','Regular seats use Regular or Management; supernumerary seats require a named eligible category.');
 if(s.seatType==='supernumerary'&&s.category==='Management')add('V-11','Ineligible supernumerary category','Management cannot be claimed as a supernumerary category.');
 if(!['Active','Released','Graduated','Withdrawn'].includes(s.status))add('IMPORT','Invalid enrolment status','Use Active, Released, Graduated or Withdrawn.','BLOCKING');
 if(s.status!=='Active'&&!s.endDate)add('V-06','Release date required','A closed enrolment must include its end date.','BLOCKING');
 return findings;
}
export function evaluateRoster(students:Student[],programmes:Programme[],batchIds:string[]=[]){
 const map=new Map<string,Finding[]>(),programmeMap=new Map(programmes.map(p=>[p.id,p]));
 for(const student of students)map.set(student.id,validateRow(student,programmeMap.get(student.programmeId)));
 const valid=students.filter(s=>outcome(map.get(s.id)!)!=='REJECTED');
 const collisionList:Collision[]=[];
 const add=(id:string,rule:string,title:string,detail:string)=>{const list=map.get(id)!;if(!list.some(f=>f.rule===rule&&(rule==='V-05'||f.detail===detail)))list.push({rule,title,detail,severity:'WARNING'});};
 const batchSet=new Set(batchIds),duplicates=new Map<string,Student[]>();
 for(const s of valid.filter(s=>batchSet.has(s.id)&&/^\d{12}$/.test(s.apaar))){const group=duplicates.get(s.apaar)||[];group.push(s);duplicates.set(s.apaar,group);}
 for(const group of duplicates.values())if(group.length>1)for(const s of group)add(s.id,'V-04','Duplicate APAAR in this submission',`${group.length} rows in this submission claim the same identifier.`);
 for(let i=0;i<valid.length;i++)for(let j=i+1;j<valid.length;j++){
  const a=valid[i],b=valid[j],overlap=overlaps(a,b);
  const exact=/^\d{12}$/.test(a.apaar)&&a.apaar===b.apaar;
  const [early,late]=a.admissionDate<=b.admissionDate?[a,b]:[b,a];
  const verifiedTransfer=exact&&early.endDate&&early.releaseVerified&&early.endDate<late.admissionDate;
  if(verifiedTransfer)continue;
  let score=0,method='',detail='';
  if(exact&&(overlap||!early.releaseVerified)){score=100;method='APAAR match';detail=overlap?'Matching APAAR with overlapping enrolment periods.':'Matching APAAR; release evidence has not been verified.';}
  else if((!/^\d{12}$/.test(a.apaar)||!/^\d{12}$/.test(b.apaar))&&overlap){score=Math.round(bigramSimilarity(a.name,b.name)*40)+(a.dob===b.dob?35:0)+15+(programmeMap.get(a.programmeId)?.name===programmeMap.get(b.programmeId)?.name?10:0);if(score>=75){method='Heuristic candidate';detail='Name, DOB and enrolment timing indicate a potential match; human review is required.';}}
  if(method){if(collisionList.length<5000)collisionList.push({studentId:a.id,otherId:b.id,method,score,detail});add(a.id,'V-05','Potential enrolment collision',`${detail} Related record: ${b.id.slice(0,8)}.`);add(b.id,'V-05','Potential enrolment collision',`${detail} Related record: ${a.id.slice(0,8)}.`);}
 }
 const programmeFindings:{programmeId:string;finding:Finding}[]=[];
 for(const p of programmes){const roster=valid.filter(s=>s.programmeId===p.id&&s.status==='Active');const regular=roster.filter(s=>s.seatType==='regular');
  if(regular.length>p.intake)for(const s of regular)add(s.id,'V-09','Approved regular intake exceeded',`${regular.length} active regular enrolments against ${p.intake} approved seats (+${regular.length-p.intake}).`);
  for(const category of categories.filter(c=>!['Regular','Management'].includes(c))){const group=roster.filter(s=>s.seatType==='supernumerary'&&s.category===category),limit=p.quotas[category]??0;if(group.length>limit)for(const s of group)add(s.id,'V-10','Configured supernumerary limit exceeded',`${category}: ${group.length} enrolments against ${limit} configured seats.`);}
  if(!roster.length)programmeFindings.push({programmeId:p.id,finding:{rule:'V-12',severity:'INFO',title:'Approved programme reports zero active enrolments',detail:p.name+' has no active enrolments.'}});
 }
 return {findings:map,collisions:collisionList,programmeFindings};
}
export function parseCSV(text:string):Record<string,string>[] {
 text=text.replace(/^\uFEFF/,'');const table:string[][]=[];let row:string[]=[],value='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++;}else if(c==='"')quoted=false;else value+=c;}else if(c==='"'){if(value.trim())throw new Error('Unexpected quote in CSV cell.');quoted=true;}else if(c===','){row.push(value.trim());value='';}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(value.trim());if(row.some(Boolean))table.push(row);row=[];value='';}else value+=c;}
 if(quoted)throw new Error('Unclosed quoted field in CSV.');row.push(value.trim());if(row.some(Boolean))table.push(row);
 if(table.length<2)throw new Error('The CSV needs a header and at least one student row.');
 const headers=table.shift()!.map(h=>h.toLowerCase().trim().replace(/[\s-]+/g,'_'));if(new Set(headers).size!==headers.length)throw new Error('CSV headers must be unique.');
 if(table.length>2000)throw new Error('Import up to 2,000 rows per file.');
 return table.map((cells,i)=>{if(cells.length!==headers.length)throw new Error(`CSV row ${i+2} has ${cells.length} columns; expected ${headers.length}.`);return Object.fromEntries(headers.map((h,j)=>[h,cells[j]]));});
}
export function csvDownload(rows:(string|number)[][]){return rows.map(row=>row.map(v=>'"'+String(v).replace(/"/g,'""').replace(/^[=+@-]/,"'$&")+'"').join(',')).join('\r\n');}
