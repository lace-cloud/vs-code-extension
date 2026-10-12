// Module detail's page.
import type { DetailMessage, DetailState } from '../protocol/registry-protocol';
import { ModuleDetail } from './ModuleDetail';
import { mountPage } from './mount';
import './detail.css';

mountPage<DetailState, DetailMessage>(ModuleDetail, { op: 'ready' });
