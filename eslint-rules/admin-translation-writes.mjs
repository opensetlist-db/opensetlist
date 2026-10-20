/**
 * `no-restricted-syntax` entry for admin routes: no `<x>Translation.deleteMany(`.
 *
 * Most admin PUT/PATCH routes save translations by deleting every row of
 * the entity and recreating them from the request body. That is only
 * correct when the body carries EVERY locale and EVERY column; a form
 * that sends part of it (one locale, no shortName) silently wipes the
 * rest. The member editor did exactly that until the stage-identity PUT
 * switched to one upsert per locale, where an omitted column is left
 * untouched. New code follows that pattern; the legacy call sites carry
 * an eslint-disable with the reason, so each one is a visible to-do.
 *
 * Matches `prisma.fooTranslation.deleteMany(...)` and
 * `tx.fooTranslation.deleteMany(...)` alike (any receiver).
 */
export const adminTranslationDeleteRestriction = {
  selector:
    "CallExpression[callee.type='MemberExpression'][callee.property.name='deleteMany'][callee.object.type='MemberExpression'][callee.object.property.name=/Translation$/]",
  message:
    "Translation writes in admin routes are per-locale upserts (see src/app/api/admin/stage-identities/[id]/route.ts); delete-and-recreate wipes shortName/other locales on partial saves",
};
