// Imports
// =============================================================================

import { useEffect, useState } from '../shims/React';
import git from '../shims/git';
import AppContext from '../shims/AppContext';

// Main
// =============================================================================

//  TODO: remove window. usage
AppContext.on('transport:capabilities', async () => {
  AppContext.sendAll('transport:capabilitiesResponse', {
    value: ['fetch', 'push'],
  });
});

const onList = async ({ forPush = false } = {}) => {
  const refs = [
    'HEAD',
    ...(await window.gitInternals.GitRefManager.listRefs({
      fs: window.fs, //TODO
      gitdir: '.git',
      filepath: `refs`,
    })).map(r => `refs/${r}`),
  ];
  const value = await Promise.all(
    refs.map(async ref => {
      const sha = await window.git.resolveRef({ dir: '/', ref });
      return { sha, ref };
    }),
  );
  if (forPush)
    AppContext.sendAll('transport:listForPushResponse', {
      value,
    });
  else
    AppContext.sendAll('transport:listResponse', {
      value,
    });
};

AppContext.on('transport:list', () => onList());
AppContext.on('transport:listForPush', () => onList({ forPush: true }));

AppContext.on('transport:fetch', async ({ value: [{ sha /*, ref */ }] }) => {
  const { /*object, type: objectType,*/ source } = await git.readObject({
    dir: '/',
    oid: sha,
    format: 'deflated',
  });

  if (source.startsWith('objects/pack')) {
    const packContents = await window.fs.readFile('.git/' + source);
    AppContext.sendAll('transport:fetchResponse', {
      value: Array.from(packContents),
      type: 'pack',
    });
  } else throw new Error('Not Implemented: it is not an pack');
});

const ArrayToString = array => new TextDecoder().decode(Uint8Array.from(array));

const writeObject = async object => {
  const { type, contents } = object;
  if (type === 'blob') {
    await git.writeBlob({ dir: '/', blob: Uint8Array.from(contents) });
  } else if (type === 'tree') {
    const parsedTree = ArrayToString(contents)
      .toString()
      .trim()
      .split('\n')
      .map(row => {
        const [mode, type, sha, path] = row.split(/\t| /);
        return { mode, type, sha, path };
      });

    await git.writeTree({ dir: '/', tree: parsedTree });
  } else if (type === 'commit') {
    git.writeCommit({ dir: '/', commit: ArrayToString(contents) });
  } else {
    throw new Error('Not Implemented');
  }
};

AppContext.on(
  'transport:push',
  async ({ objects, afterRefObject, beforeRefObject }) => {
    await Promise.all(objects.map(writeObject));
    await git.writeRef({
      dir: '/',
      ref: afterRefObject.ref,
      value: afterRefObject.sha,
      force: true,
    });
    await git.fastCheckout({ dir: '/', ref: 'master' });

    AppContext.sendAll('transport:pushResponse', {
      value: { beforeRefObject, afterRefObject },
    });
  },
);

export default ({ fs, onChange }) => {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!fs) return;
    git.plugins.set('fs', fs);
    setIsReady(true);
  }, [fs]);

  const onClone = async url => {
    await git.clone({
      dir: '/',
      corsProxy: 'https://cors.isomorphic-git.org',
      url,
    });
    onChange();
  };

  return { isReady, onClone };
};