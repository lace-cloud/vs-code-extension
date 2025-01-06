import React from 'react';

declare global {
  interface Window {
    iconPaths: { [key: string]: string };
  }
}

const icons = [
  { id: 'ec2', label: 'EC2', icon: 'ec2' },
  { id: 's3', label: 'S3', icon: 's3' },
  { id: 'lambda', label: 'Lambda', icon: 'lambda' },
];

const Sidebar: React.FC = () => {
  const handleDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="sidebar">
      <h3>AWS Services</h3>
      {icons.map((icon) => (
        <div key={icon.id} className="icon" draggable onDragStart={(e) => handleDragStart(e, icon.id)}>
          <img src={window.iconPaths[icon.icon]} alt={icon.label} className="icon-image" />
          <span>{icon.label}</span>
        </div>
      ))}
    </div>
  );
};

export default Sidebar;
