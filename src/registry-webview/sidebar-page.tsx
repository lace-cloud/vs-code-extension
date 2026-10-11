// The registry sidebar's page.
import type { SidebarMessage, SidebarState } from '../protocol/registry-protocol';
import { mountPage } from './mount';
import { Sidebar } from './Sidebar';
import './sidebar.css';

mountPage<SidebarState, SidebarMessage>(Sidebar, { op: 'ready' });
