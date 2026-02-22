import { test, expect } from 'vitest';
import {
  toTerraformIdentifier,
  isValidTerraformIdentifier,
  uniqueInstanceId,
} from '../utils/identifiers';

test('uniqueInstanceId returns original when no collision', () => {
  expect(uniqueInstanceId('s3_bucket', new Set(['iam_role']))).toBe('s3_bucket');
});

test('uniqueInstanceId suffixes on collision', () => {
  expect(uniqueInstanceId('s3_bucket', new Set(['s3_bucket']))).toBe('s3_bucket_1');
});

test('uniqueInstanceId skips existing suffixes', () => {
  expect(uniqueInstanceId('s3_bucket', new Set(['s3_bucket', 's3_bucket_1']))).toBe('s3_bucket_2');
});

test('toTerraformIdentifier converts dashes', () => {
  expect(toTerraformIdentifier('s3-bucket')).toBe('s3-bucket'); // dashes are valid
});

test('toTerraformIdentifier handles leading digit', () => {
  expect(toTerraformIdentifier('3bucket')).toBe('m_3bucket');
});

test('toTerraformIdentifier handles empty string', () => {
  expect(toTerraformIdentifier('')).toBe('module_x');
});

test('isValidTerraformIdentifier accepts valid', () => {
  expect(isValidTerraformIdentifier('s3_bucket')).toBe(true);
  expect(isValidTerraformIdentifier('_private')).toBe(true);
  expect(isValidTerraformIdentifier('my-module')).toBe(true);
});

test('isValidTerraformIdentifier rejects invalid', () => {
  expect(isValidTerraformIdentifier('3bucket')).toBe(false);
  expect(isValidTerraformIdentifier('')).toBe(false);
  expect(isValidTerraformIdentifier('has space')).toBe(false);
});
