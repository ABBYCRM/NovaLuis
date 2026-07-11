// Minimal web server for ABBYCRM/superpowers skills catalog
import express from 'express';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.static(__dirname));

// Skills catalog API
app.get('/api/skills', (req, res) => {
  const skillsDir = join(__dirname, 'skills');
  const skills = readdirSync(skillsDir).filter(name => {
    try { return statSync(join(skillsDir, name)).isDirectory(); } catch { return false; }
  });

  const catalog = skills.map(name => {
    const skillPath = join(skillsDir, name, 'SKILL.md');
    let description = '';
    let tags = (name === 'osint-tools') ? ['osint', 'reconnaissance', 'infosec'] : [];
    try {
      const content = readFileSync(skillPath, 'utf-8');
      const lines = content.split('\n');
      description = lines.find(l => l.startsWith('##'))?.replace('##', '').trim() || name;
      const extracted = (content.match(/<!-- tags:(.*?) -->/i) || [])[1]?.split(',').map(t => t.trim()) || [];
      tags = tags.length ? tags : extracted;
    } catch {}
    return { name, description, tags };
  });

  res.json({ count: catalog.length, skills: catalog });
});

// Skill detail API
app.get('/api/skills/:name', (req, res) => {
  const skillPath = join(__dirname, 'skills', req.params.name, 'SKILL.md');
  try {
    const content = readFileSync(skillPath, 'utf-8');
    res.json({ name: req.params.name, content });
  } catch {
    res.status(404).json({ error: 'Skill not found' });
  }
});

// Health check
app.get('/healthz', (req, res) => {
  const skillsDir = join(__dirname, 'skills');
  let count = 0;
  try { count = readdirSync(skillsDir).filter(n => statSync(join(skillsDir,n)).isDirectory()).length; } catch {}
  res.json({ status: 'ok', skills: count });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ABBYCRM/superpowers running on port ${PORT}`);
});
