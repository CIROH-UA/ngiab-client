import { useContext } from 'react';
import { WorkflowsContext } from '../contexts/workflowsContext';

export const useWorkflows = () => {
  const ctx = useContext(WorkflowsContext);
  if (!ctx) throw new Error('useWorkflows must be used within WorkflowsProvider');
  return ctx;
};