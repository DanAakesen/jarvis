import type { ScreenShareController } from './screen-sharing';

export function ScreenShareControls({ screenShare }: { screenShare: ScreenShareController }) {
  return (
    <section className="screen-share-controls" aria-labelledby="screen-share-heading">
      <h3 id="screen-share-heading">Screen sharing</h3>
      <p role={screenShare.sharing ? 'status' : undefined} aria-live={screenShare.sharing ? 'polite' : undefined}>
        {screenShare.sharing
          ? 'Sharing is on. Jarvis only inspects a frame when you ask.'
          : 'Share a window or screen when you want Jarvis to inspect it.'}
      </p>
      <div className="action-row">
        {screenShare.sharing
          ? <button className="secondary-button" type="button" onClick={screenShare.stop}>Stop sharing</button>
          : <button className="secondary-button" type="button" onClick={() => void screenShare.start()}>Share screen</button>}
      </div>
      {screenShare.error && <p role="alert">{screenShare.error}</p>}
    </section>
  );
}
