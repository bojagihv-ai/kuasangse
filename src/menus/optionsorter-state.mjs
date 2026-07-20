export function createOptionSorterLifecycleState(getOperationToken) {
  let active = false;
  let generation = 0;
  let archiveStatusLoadStarted = false;

  const operationStamp = () => ({ generation, token: getOperationToken() });
  const isCurrent = operation => active
    && operation.generation === generation
    && operation.token === getOperationToken();
  const claimArchiveStatusLoad = () => {
    if (archiveStatusLoadStarted) return false;
    archiveStatusLoadStarted = true;
    return true;
  };
  const onEnter = () => {
    active = true;
    generation += 1;
  };
  const onLeave = () => {
    active = false;
    generation += 1;
    archiveStatusLoadStarted = false;
  };

  return Object.freeze({
    operationStamp,
    isCurrent,
    claimArchiveStatusLoad,
    onEnter,
    onLeave,
  });
}
