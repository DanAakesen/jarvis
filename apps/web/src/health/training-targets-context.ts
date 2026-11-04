import { createContext, useContext, useEffect } from 'react';
import { trainingTargetsFailureMessage, type TrainingTargetsState, type TrainingTargetsView } from './training-targets';

export interface TrainingTargetsShared {
  view: TrainingTargetsView;
  retry: () => void;
  /** Takes a state the server just returned, for example from a save, so every card shows it without another read. */
  apply: (state: TrainingTargetsState) => void;
  /** Starts the read. Called by views that show targets, so a section with none never asks. */
  want: () => void;
}

const noop = () => {};
const outsideHealth: TrainingTargetsShared = {
  view: { status: 'error', kind: 'unavailable', message: trainingTargetsFailureMessage('unavailable', 'load') },
  retry: noop, apply: noop, want: noop,
};

export const TrainingTargetsContext = createContext<TrainingTargetsShared>(outsideHealth);

/** The shared targets for a view that shows them. Mounting the view starts the read. */
export function useTrainingTargetsShared(): TrainingTargetsShared {
  const shared = useContext(TrainingTargetsContext);
  const { want } = shared;
  useEffect(() => want(), [want]);
  return shared;
}
