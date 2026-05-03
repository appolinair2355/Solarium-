import { useState, useEffect } from 'react';

export function useVideoPlayer({ durations }: { durations: Record<string, number> }) {
  const [currentScene, setCurrentScene] = useState(0);

  useEffect(() => {
    const sceneKeys = Object.keys(durations);
    let timeoutId: NodeJS.Timeout;
    let isFirstPass = true;

    const playNext = (index: number) => {
      const duration = durations[sceneKeys[index]];
      timeoutId = setTimeout(() => {
        if (index + 1 < sceneKeys.length) {
          setCurrentScene(index + 1);
          playNext(index + 1);
        } else {
          if (isFirstPass && typeof window !== 'undefined' && (window as any).stopRecording) {
            (window as any).stopRecording();
            isFirstPass = false;
          }
          setCurrentScene(0);
          playNext(0);
        }
      }, duration);
    };

    if (typeof window !== 'undefined' && (window as any).startRecording) {
      (window as any).startRecording();
    }

    playNext(0);

    return () => clearTimeout(timeoutId);
  }, []);

  return { currentScene };
}
