import { Operation } from "../Operation"
import { StringWithState } from "../StringWithState"

export function randomString(size: number) {
    return Math.random()
        .toString(36)
        .substr(2, size)
}

export function randomInt(dist: number) {
    //return 0~dist-1
    return Math.floor(Math.random() * dist)
}

export function randomOperation(length: number) {
    let from = randomInt(length) // 0~length-1
    let numDeleted = randomInt(length - from + 1) // 0~length-from

    if (numDeleted > 0) return new Operation(from, numDeleted, randomString(randomInt(3)))
    else return new Operation(from, numDeleted, randomString(randomInt(2) + 1))
}

export function randomUserOperations(baseLength: number, numOps = 0) {
    let length = baseLength
    let ops: Operation[] = []
    let numIter = numOps > 0 ? numOps : randomInt(4) + 1
    for (let i = 0; i < numIter; i++) {
        let op = randomOperation(length)
        length += op.content.length - op.numDeleted
        ops.push(op)
    }
    return ops
}

export function randomStringWithState() {
    return new StringWithState(randomString(randomInt(5) + 1))
}
