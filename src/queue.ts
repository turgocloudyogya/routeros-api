import { Task } from "./types"

export class TaskQueue {
  private queue: Task[] = []
  private pending: Task | null = null

  enqueue(task: Task): void {
    this.queue.push(task)
  }

  dequeue(): Task | undefined {
    if (this.pending) return undefined
    const task = this.queue.shift()
    if (task) {
      this.pending = task
    }
    return task
  }

  complete(): void {
    this.pending = null
  }

  peek(): Task | undefined {
    return this.queue[0]
  }

  get length(): number {
    return this.queue.length
  }

  get isPending(): boolean {
    return this.pending !== null
  }

  getPending(): Task | null {
    return this.pending
  }

  clear(): void {
    this.queue = []
    this.pending = null
  }
}
