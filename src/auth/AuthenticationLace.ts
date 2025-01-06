import * as vscode from 'vscode';
import axios from 'axios';

let isAuthenticated = false;

export function setAuthenticationStatus(status: boolean): void {
  isAuthenticated = status;
}


export function getAuthenticationStatus(): boolean {
    console.log('Current Authentication Status:', isAuthenticated);
    return isAuthenticated;
  }
  

export async function authenticateWithLace(): Promise<void> {
  try {
    const result = await vscode.window.showInformationMessage(
      'Redirecting to Lace for authentication...',
      'Open Lace'
    );

    if (result === 'Open Lace') {
      await vscode.env.openExternal(vscode.Uri.parse('https://api.lace.cloud/api/auth/github'));
    }

    const token = await vscode.authentication.getSession('github', ['read:user'], { forceNewSession: true });

    if (!token) {
      vscode.window.showErrorMessage('Authentication failed. No token retrieved.');
      setAuthenticationStatus(false);
      return;
    }

    const response = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    });

    if (response.status === 200) {
      vscode.window.showInformationMessage('Successfully connected to Lace!');
      setAuthenticationStatus(true);
    } else {
      vscode.window.showErrorMessage('Failed to authenticate with Lace.');
      setAuthenticationStatus(false);
    }
  } catch (error) {
    vscode.window.showErrorMessage(`Authentication error: ${error}`);
    setAuthenticationStatus(false);
  }
}
