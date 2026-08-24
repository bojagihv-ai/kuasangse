import { text, validateOrder } from './batch-control-contract.mjs';

/**
 * 받아온 주문을 검사하고 ack 까지 마친다.
 *
 * 이 두 단계가 조용히 실패하면 관제탑은 그 작업을 '실행 중' 으로 붙든 채 아무도 그 일을
 * 하지 않는 상태가 된다. 워커가 하나뿐이라 뒤에 선 작업까지 함께 멈춘다.
 * 그래서 받을 수 없는 이유는 반드시 fail 로 돌려준다.
 */
export async function acceptWorkOrder({ order, workerId, post, endpoints, onError = null }) {
  const notify = error => {
    if (typeof onError === 'function') onError(error);
  };
  try {
    const accepted = validateOrder(order);
    await post(endpoints.ack(accepted.orderId), {
      ...accepted,
      workerId,
      accepted: true,
      eventSequence: 1,
    });
    return accepted;
  } catch (error) {
    notify(error);
    const orderId = text(order?.orderId);
    if (orderId) {
      try {
        await post(endpoints.fail(orderId), {
          ...order,
          workerId,
          eventSequence: 1,
          error: String(error?.code || error?.message || error),
        });
      } catch (reportError) {
        notify(reportError);
      }
    }
    throw error;
  }
}
