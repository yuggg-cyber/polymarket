/**
 * 简单的并发控制队列
 */
export function createQueue(concurrency: number) {
  let running = 0
  const queue: (() => void)[] = []

  function next() {
    if (running >= concurrency || queue.length === 0) return
    running++
    const task = queue.shift()!
    task()
  }

  return {
    add<T>(fn: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        queue.push(() => {
          fn()
            .then(resolve)
            .catch(reject)
            .finally(() => {
              running--
              next()
            })
        })
        next()
      })
    },
  }
}
