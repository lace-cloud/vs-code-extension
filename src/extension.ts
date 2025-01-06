
import * as vscode from 'vscode';
import { ComponentsTreeDataProvider } from './containers-views/ComponentsTreeDataProvider';
import { TemplatesTreeDataProvider} from './containers-views/TemplatesTreeDataProvider';
import {setAuthenticationStatus,authenticateWithLace} from './auth/AuthenticationLace';
import {updateStatusBar} from './statusbar/UpdateStatusBar';
import { addComponent, getComponents, removeComponent, initializeDatabase, saveCanvasState, getComponentIdByName, loadCanvasState } from './database';
import { createWebviewPanel } from './webview/createWebviewPanel';


let componentsProvider: ComponentsTreeDataProvider | undefined;
let templatesProvider: TemplatesTreeDataProvider | undefined;
const panels: Map<string, vscode.WebviewPanel> = new Map();

// Global state for authentication
let isAuthenticated = false;
let statusBarItem: vscode.StatusBarItem | undefined;

// Refresh tree views for both components and templates
function refreshTreeViews(): void {
  if (componentsProvider) {
    componentsProvider.refresh();
  }
  if (templatesProvider) {
    templatesProvider.refresh();
  }
}

// Function to refresh UI based on authentication status
function refreshUI(): void {
  isAuthenticated = false; // Assume the user is signed out by default
  vscode.authentication.getSession('github', ['read:user'], { createIfNone: false }).then(session => {
    if (session) {
      isAuthenticated = true;
    }
    setAuthenticationStatus(isAuthenticated);
    // Update UI based on the current authentication state
    updateStatusBar();
    refreshTreeViews();
  });
}

// Activate Extension
export async function activate(context: vscode.ExtensionContext) {
  console.log('Lace Extension Activated');

  console.log('Ensure the database schema is ready');
  await initializeDatabase(); // Ensure the database schema is ready

  // Assign to global variables to ensure they can be accessed in refreshTreeViews
  componentsProvider = new ComponentsTreeDataProvider();
  templatesProvider = new TemplatesTreeDataProvider();

  vscode.window.registerTreeDataProvider('components', componentsProvider);
  vscode.window.registerTreeDataProvider('templates', templatesProvider);

  // Register "Connect to Lace" Command
  context.subscriptions.push(
    vscode.commands.registerCommand('lace.connect', async () => {
      await authenticateWithLace();
      refreshTreeViews(); // Properly refresh tree views after authentication
    })
  );

  // Command to add a component
  context.subscriptions.push(
    vscode.commands.registerCommand('components.addComponent', async () => {
      if (!isAuthenticated) {
        vscode.window.showErrorMessage('Please connect to Lace to use this feature.');
        return;
      }

      const componentName = await vscode.window.showInputBox({
        prompt: 'Enter the name of the new component',
      });

      if (!componentName) {
        vscode.window.showErrorMessage('Component name cannot be empty.');
        return;
      }

      try {
        await addComponent(componentName);
        vscode.window.showInformationMessage(`Component "${componentName}" added successfully.`);
        componentsProvider?.refresh(); // Refresh Components view
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to add component: ${error}`);
      }
    })
  );

  // Command to remove a component
  context.subscriptions.push(
    vscode.commands.registerCommand('components.removeComponent', async () => {
      if (!isAuthenticated) {
        vscode.window.showErrorMessage('Please connect to Lace to use this feature.');
        return;
      }

      const components = await getComponents();
      const componentNames = components.map((comp) => comp.name);

      const componentName = await vscode.window.showQuickPick(componentNames, {
        placeHolder: 'Select a component to remove',
      });

      if (!componentName) {
        vscode.window.showErrorMessage('No component selected.');
        return;
      }

      try {
        const component = components.find((comp) => comp.name === componentName);
        if (component) {
          await removeComponent(component.id);
          vscode.window.showInformationMessage(`Component "${componentName}" removed successfully.`);
          componentsProvider?.refresh(); // Refresh Components view
        } else {
          vscode.window.showErrorMessage('Component not found.');
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to remove component: ${error}`);
      }
    })
  );

    // Command to save the state via File > Save
  context.subscriptions.push(
    vscode.commands.registerCommand('workbench.action.files.save', () => {
      const activePanel = [...panels.values()].find((panel) => panel.active);
      if (!activePanel) {
        vscode.window.showErrorMessage('No active component to save.');
        return;
      }

      activePanel.webview.postMessage({ command: 'triggerSave' });
    })
  );

  const saveAsCommand = vscode.commands.registerCommand(
    'workbench.action.files.saveAs',
    () => {
      vscode.window.showErrorMessage('Save As is disabled in this workspace.');
    }
  );

  context.subscriptions.push(saveAsCommand);
 
  

  // Command to open a component in the playground
  context.subscriptions.push(
    vscode.commands.registerCommand('components.openComponent', (componentName: string) => {
      console.log('opened the component');
      createWebviewPanel(componentName, context);
    })
  );

  // Listen to authentication session changes
  vscode.authentication.onDidChangeSessions(event => {
    if (event.provider.id === 'github') {
      refreshUI(); // Refresh the UI based on authentication state
    }
  });

  // Create and update the status bar item
  updateStatusBar();

  // Dispose of the status bar item when the extension is deactivated
  context.subscriptions.push({
    dispose: () => {
      statusBarItem?.dispose();
    },
  });

  // Initial UI refresh to handle authentication state at startup
  refreshUI();
}


// Deactivate Extension
export function deactivate() {
  console.log('Lace Extension Deactivated.');
  statusBarItem?.dispose();
}

