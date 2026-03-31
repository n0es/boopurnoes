import { Client } from 'pg';
import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config({ path: '.env.local' });

const SKILLS_JSON_URL = 'https://gametora.com/data/umamusume/skills.5d6eddd9.json';

interface GametoraSkill {
  id: number;
  name_en?: string;
  enname?: string;
  jpname?: string;
  desc_en?: string;
  endesc?: string;
  jpdesc?: string;
  iconid?: number;
  gene_version?: GametoraSkill;
}

async function syncAllSkills() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL
  });

  try {
    await client.connect();
    console.log('Connected to database. Fetching skills from Gametora...');

    const resp = await fetch(SKILLS_JSON_URL);
    if (!resp.ok) throw new Error(`Failed to fetch skills: ${resp.status}`);
    const skills = await resp.json() as GametoraSkill[];

    console.log(`Fetched ${skills.length} skills. Processing...`);

    let count = 0;
    for (const s of skills) {
      // Main skill
      await upsertSkill(client, s);
      count++;

      // Gene version (rarity variations)
      if (s.gene_version) {
        await upsertSkill(client, s.gene_version, s);
        count++;
      }
    }

    console.log(`Successfully processed ${count} skills (including rarity variations).`);
  } catch (err) {
    console.error('Error syncing skills:', err);
  } finally {
    await client.end();
  }
}

async function upsertSkill(client: Client, s: GametoraSkill, parent?: GametoraSkill) {
  const gametora_id = s.id;
  const name = s.name_en || s.enname || (parent ? (parent.name_en || parent.enname) : null) || s.jpname;
  const description = s.desc_en || s.endesc || (parent ? (parent.desc_en || parent.endesc) : null) || s.jpdesc;
  const icon_id = s.iconid || (parent ? parent.iconid : null);
  const icon_url = icon_id ? `https://gametora.com/images/umamusume/skill_icons/utx_ico_skill_${icon_id}.png` : null;

  const query = `
    INSERT INTO public.skills (gametora_id, name, description, icon_url)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (gametora_id) DO UPDATE SET
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      icon_url = EXCLUDED.icon_url
  `;

  await client.query(query, [gametora_id, name, description, icon_url]);
}

syncAllSkills();
