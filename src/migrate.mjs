

export const OLD_ID = 'draw-steel-chat-polish';
export const MIGRATED = 'migratedFromChatPolish';

export const migrateLocalStorage = (newId) => {
  let moved = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`${OLD_ID}.`)) continue;
      const target = `${newId}.${key.slice(OLD_ID.length + 1)}`;
      if (localStorage.getItem(target) !== null) continue;
      localStorage.setItem(target, localStorage.getItem(key));
      moved++;
    }
  } catch {  }
  if (moved) console.log(`${newId} | carried ${moved} setting(s) over from the old module name`);
  return moved;
};

export const migrateWorldSettings = async (newId, key) => {
  if (!game.users.activeGM?.isSelf) return false;
  const done = game.settings.get(newId, MIGRATED) ?? [];
  if (done.includes(key)) return false;
  let copied = false;
  try {
    const current = game.settings.get(newId, key);
    const old = game.settings.storage.get('world')?.getSetting(`${OLD_ID}.${key}`);
    const value = old?.value;
    const has = (v) => (Array.isArray(v) ? v.length : v);
    if (!has(current) && has(value)) {
      await game.settings.set(newId, key, value);
      console.log(`${newId} | carried ${Array.isArray(value) ? value.length : 1} record(s) of ${key} over from the old module name`);
      copied = true;
    }
  } catch (err) {
    console.warn(`${newId} | could not carry ${key} over from the old module name:`, err);
    return false;
  }
  await game.settings.set(newId, MIGRATED, [...done, key]);
  return copied;
};
