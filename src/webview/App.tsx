import React from 'react';
import Sidebar from './Sidebar';
import {Canvas} from './Canvas';
import './App.css';

const App: React.FC = () => {
  return (
    <div className="app">
      <Sidebar />
      <Canvas />
    </div>
  );
};

export default App;

