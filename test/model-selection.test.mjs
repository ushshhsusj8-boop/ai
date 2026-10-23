import test from 'node:test';
import assert from 'node:assert/strict';
import {chatSelectionProblem} from '../public/connection_tools.js';
const mine={id:'mine-1234567890abcdef12345678',model:'private-a',models:[{id:'private-a'},{id:'private-b'}]};
const shared={id:'deepseek',model:'shared-a',models:[{id:'shared-a'}]};
test('missing private endpoints cannot reuse the currently displayed shared provider',()=>{
  const conversation={provider:mine.id,model:'private-a'};
  assert.ok(chatSelectionProblem(conversation,undefined,''));
  assert.ok(chatSelectionProblem(conversation,shared,'shared-a'));
  assert.deepEqual(conversation,{provider:mine.id,model:'private-a'});
});
test('removed or mismatched models require explicit reselection rather than the first remaining model',()=>{
  const conversation={provider:mine.id,model:'removed-model'};
  assert.ok(chatSelectionProblem(conversation,mine,'removed-model'));
  assert.ok(chatSelectionProblem(conversation,mine,'private-a'));
  assert.ok(chatSelectionProblem(conversation,mine,''));
  assert.equal(conversation.model,'removed-model');
});
test('matching saved selections and explicitly chosen new conversations remain usable',()=>{
  assert.equal(chatSelectionProblem({provider:mine.id,model:'private-b'},mine,'private-b'),'');
  assert.equal(chatSelectionProblem({provider:shared.id,model:'shared-a'},shared,'shared-a'),'');
  assert.equal(chatSelectionProblem(null,mine,'private-a'),'');
  assert.equal(chatSelectionProblem({provider:'single'}, {id:'single',model:'default-model'},'default-model'),'');
});
