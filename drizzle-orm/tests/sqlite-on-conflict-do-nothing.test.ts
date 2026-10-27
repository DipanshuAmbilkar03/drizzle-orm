import { DatabaseSync } from 'node:sqlite';
import { describe, expect, test } from 'vitest';
import { drizzle } from '~/node-sqlite';
import { isNull, sql } from '~/sql';
import { integer, sqliteTable, text } from '~/sqlite-core';

const users = sqliteTable('users', {
	id: integer().primaryKey(),
	email: text().notNull(),
	deletedAt: integer('deleted_at'),
});

function createDb() {
	const client = new DatabaseSync(':memory:');
	client.exec(`
		CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL, deleted_at INTEGER);
		CREATE UNIQUE INDEX active_users_email_idx ON users (email) WHERE deleted_at IS NULL;
	`);
	return drizzle({ client });
}

describe('onConflictDoNothing with a target and where', () => {
	test('places the target where clause before do nothing', () => {
		const db = createDb();

		const query = db
			.insert(users)
			.values({ id: 1, email: 'a@example.com' })
			.onConflictDoNothing({ target: users.email, where: isNull(users.deletedAt) });

		const { sql: text, params } = query.toSQL();

		expect(text).toBe(
			'insert into "users" ("id", "email", "deleted_at") values (?, ?, null) on conflict ("users"."email") where ("users"."deleted_at" is null) do nothing',
		);
		expect(params).toEqual([1, 'a@example.com']);
	});

	test('is accepted by SQLite', async () => {
		const db = createDb();

		await db.insert(users).values({ id: 1, email: 'a@example.com' });

		// Conflicts with the partial unique index, so the second insert is a no-op.
		await db
			.insert(users)
			.values({ id: 2, email: 'a@example.com' })
			.onConflictDoNothing({ target: users.email, where: isNull(users.deletedAt) });

		const rows = await db.select().from(users).orderBy(users.id);

		expect(rows).toEqual([{ id: 1, email: 'a@example.com', deletedAt: null }]);
	});

	test('does not conflict with a soft-deleted row', async () => {
		const db = createDb();

		await db.insert(users).values({ id: 1, email: 'a@example.com', deletedAt: 1 });

		await db
			.insert(users)
			.values({ id: 2, email: 'a@example.com' })
			.onConflictDoNothing({ target: users.email, where: isNull(users.deletedAt) });

		const rows = await db.select().from(users).orderBy(users.id);

		expect(rows).toEqual([
			{ id: 1, email: 'a@example.com', deletedAt: 1 },
			{ id: 2, email: 'a@example.com', deletedAt: null },
		]);
	});

	test('keeps the clause unchanged without a where', () => {
		const db = createDb();

		const query = db
			.insert(users)
			.values({ id: 1, email: 'a@example.com' })
			.onConflictDoNothing({ target: users.email });

		expect(query.toSQL().sql).toBe(
			'insert into "users" ("id", "email", "deleted_at") values (?, ?, null) on conflict ("users"."email") do nothing',
		);
	});

	test('supports a sql`` where clause', () => {
		const db = createDb();

		const query = db
			.insert(users)
			.values({ id: 1, email: 'a@example.com' })
			.onConflictDoNothing({ target: users.email, where: sql`${users.deletedAt} is null` });

		expect(query.toSQL().sql).toContain('where "users"."deleted_at" is null do nothing');
	});
});
