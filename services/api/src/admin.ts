import type { Context, Hono } from 'hono';
import { listPeople, setPersonRole, type Catalog } from '@rebbehub/core';
import { one } from '@rebbehub/db';
import { HttpError } from './app.js';

/**
 * The stewards' own pages (the plan, section 11: stewards hold roles,
 * policies and takedowns). Stewards see everyone with an account and
 * suspend or restore them; platform admins, above stewards, also appoint
 * and remove stewards and admins. Nobody suspends or demotes an admin but
 * another admin, and an admin never removes their own admin.
 */
export function adminRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>): void {
  const db = catalog.db;

  /** Who is asking, and what they may do here. */
  const roleOf = async (c: Context) => {
    const id = await signedIn(c);
    const person = await one<{ steward: boolean; admin: boolean }>(db, 'SELECT steward, admin FROM auth.person WHERE id = $1', [id]).catch(() => null);
    const account = await catalog.account(id);
    const admin = Boolean(person?.admin);
    return { id, admin, steward: admin || Boolean(person?.steward) || Boolean(account?.is_steward) };
  };

  const target = async (id: string) => {
    const person = await one<{ id: string; display_name: string; admin: boolean }>(db, 'SELECT id, display_name, admin FROM auth.person WHERE id = $1', [id]);
    if (!person) throw new HttpError(404, `no one has the account number ${id}`);
    // Their catalog account, made now if they have not yet done anything there.
    await catalog.createAccount({ id: person.id, displayName: person.display_name });
    return person;
  };

  app.get('/v1/admin/people', async (c) => {
    const me = await roleOf(c);
    if (!me.steward) throw new HttpError(403, 'only stewards see this');
    const people = await listPeople(db, { q: c.req.query('q') || undefined });
    // A person's email is shown to admins only.
    return c.json({ me: { admin: me.admin }, people: people.map((p) => (me.admin ? p : { ...p, google: p.google ? 'Google' : null })) });
  });

  app.post('/v1/admin/people/:id/role', async (c) => {
    const me = await roleOf(c);
    if (!me.admin) throw new HttpError(403, 'only platform admins appoint stewards and admins');
    const input = (await c.req.json().catch(() => ({}))) as { steward?: boolean; admin?: boolean };
    const person = await target(c.req.param('id'));
    if (person.id === me.id && input.admin === false) throw new HttpError(400, 'an admin never removes their own admin');
    if (person.admin && input.steward === false && input.admin !== false) throw new HttpError(400, 'an admin is always a steward; remove the admin first');
    await setPersonRole(db, person.id, { steward: input.steward, admin: input.admin });
    const now = await one<{ steward: boolean }>(db, 'SELECT steward FROM auth.person WHERE id = $1', [person.id]);
    await catalog.setSteward(me.id, person.id, Boolean(now?.steward));
    return c.json({ ok: true });
  });

  app.post('/v1/admin/people/:id/suspend', async (c) => {
    const me = await roleOf(c);
    if (!me.steward) throw new HttpError(403, 'only stewards suspend accounts');
    const input = (await c.req.json().catch(() => ({}))) as { on?: boolean; reason?: string };
    const person = await target(c.req.param('id'));
    if (person.id === me.id) throw new HttpError(400, 'you cannot suspend yourself');
    if (person.admin && !me.admin) throw new HttpError(403, 'a platform admin is suspended only by another admin');
    await catalog.setSuspended(me.id, person.id, input.on !== false, input.reason);
    return c.json({ ok: true });
  });
}
