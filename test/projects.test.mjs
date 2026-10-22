import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProjects, projectContext, createProjectStore } from '../public/projects.js';
const doc = (id = 'file-0001', text = '统一资料') => ({ id, name: '项目.txt', enabled: true, sections: [{ label: '段落 1', text }] });
const project = (id = 'project-a') => ({ id, name: '网站开发', instructions: '请中文回答', revision: 0, documents: [doc()] });
const state = () => ({ version: 1, projects: [project(), { ...project('project-b'), documents: [doc('file-0002', '另一个项目')] }], links: [{ conversationId: 'conversation-a', projectId: 'project-a' }, { conversationId: 'conversation-b', projectId: 'project-a' }] });
test('project context reuses one library in multiple chats and isolates other projects', () => {
  const s = state();
  for (const id of ['conversation-a', 'conversation-b']) {
    const input = projectContext(s, { id, instructions: '简短' });
    assert.deepEqual(input.documents, [doc()]); assert.equal(input.instructions, '请中文回答\n\n简短');
  }
  assert.deepEqual(projectContext(s, { id: 'unlinked-chat' }).documents, []);
  const captured = projectContext(s, { id: 'conversation-a' }); s.projects[0].documents[0].sections[0].text = '新资料';
  assert.equal(captured.documents[0].sections[0].text, '统一资料');
});
test('paused files excluded, combined limits reject without silent dropping', () => {
  const s = state(); s.projects[0].documents[0].enabled = false;
  assert.equal(projectContext(s, { id: 'conversation-a' }).documents.length, 0);
  s.projects[0].documents = [doc(), doc('file-0003'), doc('file-0004')];
  assert.throws(() => projectContext(s, { id: 'conversation-a', documents: [doc('file-0005')] }), /合计最多/);
  assert.throws(() => projectContext(s, { id: 'conversation-a', instructions: '字'.repeat(2000) }), /2000/);
});
test('project backups round trip and reject duplicate IDs, dangling or duplicate associations', () => {
  const s = state(); assert.deepEqual(validateProjects(JSON.parse(JSON.stringify(s))), s);
  assert.throws(() => validateProjects({ ...s, projects: [...s.projects, project()] }), /版本无效/);
  assert.throws(() => validateProjects({ ...s, links: [{ conversationId: 'conversation-a', projectId: 'missing-id' }] }), /关联无效/);
  assert.throws(() => validateProjects({ ...s, links: [...s.links, s.links[0]] }), /关联无效/);
  assert.throws(() => validateProjects({ ...s, projects: [{ ...project(), instructions: 'a'.repeat(2001) }] }), /版本无效/);
});
test('capacity checks reject excess projects, invalid documents and full libraries', () => {
  assert.throws(() => validateProjects({ version: 1, links: [], projects: Array.from({ length: 21 }, (_,i) => project('project-' + i)) }), /最多 20/);
  assert.throws(() => validateProjects({ version: 1, links: [], projects: [{ ...project(), documents: [doc('file-0001', 'a'.repeat(120001))] }] }), /12 万/);
  assert.throws(() => validateProjects({ version: 1, links: [], projects: Array.from({ length: 20 }, (_,i) => ({ ...project('project-' + i), documents: [doc('file-0001','字'.repeat(120000)), doc('file-0002','字'.repeat(120000)), doc('file-0003','字'.repeat(120000))] })) }), /已满/);
});
test('storage unavailable explicitly fails instead of reporting successful save', async () => {
  await assert.rejects(createProjectStore(null).read(), /不可用/);
  await assert.rejects(createProjectStore(null).save(project()), /不可用/);
});
