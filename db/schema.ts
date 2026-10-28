import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const institutions = sqliteTable('institutions', {
  id: text('id').primaryKey(), owner: text('owner_id').notNull(), code: text('code').notNull(), payload: text('payload').notNull(),
}, table => [uniqueIndex('institution_owner_code').on(table.owner, table.code)]);
export const programmes = sqliteTable('programmes', {
  id: text('id').primaryKey(), owner: text('owner_id').notNull(), institutionId: text('institution_id').notNull().references(()=>institutions.id), name: text('name').notNull(), payload: text('payload').notNull(),
}, table => [uniqueIndex('programme_owner_institution_name').on(table.owner, table.institutionId, table.name)]);
export const students = sqliteTable('students', {
  id: text('id').primaryKey(), owner: text('owner_id').notNull(), institutionId: text('institution_id').notNull().references(()=>institutions.id), programmeId: text('programme_id').notNull().references(()=>programmes.id), apaarKey: text('apaar_key'), payload: text('payload').notNull(),
}, table => [index('student_owner_institution').on(table.owner,table.institutionId),index('student_apaar_key').on(table.owner,table.apaarKey)]);
export const batches = sqliteTable('batches', {
  id: text('id').primaryKey(), owner: text('owner_id').notNull(), institutionId: text('institution_id').notNull().references(()=>institutions.id), payload: text('payload').notNull(),
}, table => [index('batch_owner').on(table.owner)]);
export const audit = sqliteTable('audit_events', {
  id: text('id').primaryKey(), owner: text('owner_id').notNull(), actor: text('actor').notNull(), action: text('action').notNull(), entityId: text('entity_id').notNull(), detail: text('detail').notNull(), timestamp: text('timestamp').notNull(),
}, table => [index('audit_owner_time').on(table.owner,table.timestamp)]);
export const reviews = sqliteTable('reviews', {
  id:text('id').primaryKey(),owner:text('owner_id').notNull(),studentId:text('student_id').notNull().references(()=>students.id),payload:text('payload').notNull(),
},table=>[index('reviews_owner_student').on(table.owner,table.studentId)]);
export const googleAccounts=sqliteTable('google_accounts',{
 subject:text('subject').primaryKey(),ownerId:text('owner_id').notNull(),email:text('email').notNull(),displayName:text('display_name').notNull(),createdAt:integer('created_at').notNull(),
},table=>[uniqueIndex('google_account_owner').on(table.ownerId)]);
export const authSessions=sqliteTable('auth_sessions',{
 tokenHash:text('token_hash').primaryKey(),ownerId:text('owner_id').notNull(),subject:text('subject').notNull().references(()=>googleAccounts.subject),expiresAt:integer('expires_at').notNull(),createdAt:integer('created_at').notNull(),
},table=>[index('auth_session_expiry').on(table.expiresAt)]);
export const oauthFlows=sqliteTable('oauth_flows',{
 stateHash:text('state_hash').primaryKey(),browserHash:text('browser_hash').notNull(),nonce:text('nonce').notNull(),verifier:text('verifier').notNull(),returnTo:text('return_to').notNull(),linkOwnerId:text('link_owner_id'),expiresAt:integer('expires_at').notNull(),
},table=>[index('oauth_flow_expiry').on(table.expiresAt)]);
