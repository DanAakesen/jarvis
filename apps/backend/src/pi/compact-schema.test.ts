import { chatBlockInputSchema, workspaceCommandSchema } from '@jarvis/contracts';
import { describe, expect, it } from 'vitest';
import { compactSchema, expandSchema } from './compact-schema.js';

const repeated = { type: 'object', properties: { label: { type: 'string', minLength: 1, maxLength: 200, description: 'A long enough description to be worth sharing between branches.' } }, required: ['label'], additionalProperties: false };

describe('compactSchema', () => {
  it('writes a repeated subschema once and gives the same schema back when expanded', () => {
    const schema = { type: 'object', properties: { first: repeated, second: repeated, third: { type: 'array', items: repeated } }, required: ['first'] };
    const compact = compactSchema(schema);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length);
    expect(JSON.stringify(compact).match(/#\/\$defs\//gu)).toHaveLength(3);
    expect(expandSchema(compact)).toEqual(schema);
  });

  it('leaves a schema without repeats, and enum or default values, exactly as they are', () => {
    const plain = { type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'] }, size: { type: 'integer', minimum: 1 } } };
    expect(compactSchema(plain)).toBe(plain);
    const values = { type: 'object', properties: { x: { type: 'array', default: [repeated, repeated], items: { type: 'string' } } } };
    expect(compactSchema(values)).toBe(values);
  });

  it('keeps the contracts of the two biggest tools equivalent and several times smaller', () => {
    for (const schema of [chatBlockInputSchema, workspaceCommandSchema]) {
      const compact = compactSchema(schema);
      expect(expandSchema(compact)).toEqual(schema);
      expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(schema).length / 2);
    }
  });
});
