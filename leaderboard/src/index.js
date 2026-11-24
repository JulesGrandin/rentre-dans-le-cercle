const MAX_SCORE = 9000;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} '\u2019.-]{0,18}[\p{L}\p{N}.]$/u;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function nameKey(name) {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

function cleanName(value) {
  const name = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!NAME.test(name)) return null;
  return name;
}

async function standings(db, youKey) {
  const rows = await db.prepare(
    `SELECT name, name_key, score
     FROM scores
     ORDER BY score ASC, updated_at ASC, name_key ASC`
  ).all();
  const entries = (rows.results || []).map((row, index) => ({
    rank: index + 1,
    name: row.name,
    score: row.score,
    yours: youKey != null && row.name_key === youKey,
  }));
  const yours = entries.find((entry) => entry.yours) || null;
  let visible = entries.slice(0, 15);
  if (yours && !visible.some((entry) => entry.yours)) visible = visible.concat(yours);
  return {
    total: entries.length,
    rank: yours ? yours.rank : null,
    best: yours ? yours.score : null,
    entries: visible,
  };
}

async function saveScore(db, name, score) {
  const key = nameKey(name);
  const existing = await db.prepare(
    `SELECT score FROM scores WHERE name_key = ?`
  ).bind(key).first();

  let status = "created";
  if (!existing) {
    await db.prepare(
      `INSERT INTO scores (name, name_key, score) VALUES (?, ?, ?)`
    ).bind(name, key, score).run();
  } else if (score < existing.score) {
    await db.prepare(
      `UPDATE scores SET name = ?, score = ?, updated_at = datetime('now') WHERE name_key = ?`
    ).bind(name, score, key).run();
    status = "improved";
  } else {
    status = "kept";
  }

  const board = await standings(db, key);
  return { status, ...board };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/scores") return json({ error: "introuvable" }, 404);

    if (request.method === "GET") {
      const name = cleanName(url.searchParams.get("name") || "");
      const board = await standings(env.DB, name ? nameKey(name) : null);
      return json(board);
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "score" }, 400);
      }
      const name = cleanName(body.name);
      const score = Number(body.score);
      if (!name) return json({ error: "pseudo" }, 400);
      if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return json({ error: "score" }, 400);
      const board = await saveScore(env.DB, name, score);
      return json(board);
    }

    return json({ error: "introuvable" }, 404);
  },
};
