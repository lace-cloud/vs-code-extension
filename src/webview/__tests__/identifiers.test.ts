import { test, expect } from 'vitest';
import { toTerraformIdentifier, uniqueInstanceId } from '../utils/identifiers';

test('uniqueInstanceId suffixes on collision', () => {
  expect(uniqueInstanceId('s3_bucket', new Set(['s3_bucket']))).toBe('s3_bucket_1');
});

test('uniqueInstanceId skips existing suffixes', () => {
  expect(uniqueInstanceId('s3_bucket', new Set(['s3_bucket', 's3_bucket_1']))).toBe('s3_bucket_2');
});

test('toTerraformIdentifier handles leading digit', () => {
  expect(toTerraformIdentifier('3bucket')).toBe('m_3bucket');
});
