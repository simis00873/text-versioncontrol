import Delta = require('quill-delta')
import Op from 'quill-delta/dist/Op'
import * as _ from 'underscore'
import { Excerpt, ExcerptSource, BatchExcerptSync, ExcerptTarget, ExcerptUtil, ExcerptSync } from '../excerpt'
import { ExcerptMarker } from '../excerpt/ExcerptMarker';
import { History, IHistory } from '../history/History'
import { SyncResponse } from '../history/SyncResponse'
import { Change } from '../primitive/Change'
import { ExDelta } from '../primitive/ExDelta'
import { printChange } from '../primitive/printer';
import { Range } from '../primitive/Range'
import { Source } from '../primitive/Source'
import {
    asChange,
    JSONStringify,
    flattenTransformedChange,
    flattenChanges,
    expectEqual,
    normalizeChanges,
    contentLength,
    cropContent,
    isEqual,
    reverseChange
} from '../primitive/util'



export interface ExcerptMarkerWithOffset extends ExcerptMarker{
    offset: number
}


export class Document {
    private history: IHistory

    constructor(public readonly name: string, content: string | Change) {
        this.history = new History(name, asChange(content))
    }

    public getName():string {
        return this.history.name
    }

    public clone():Document
    {
        const doc = new Document(this.name, '')
        doc.history = this.history.clone()
        return doc
    }

    public getCurrentRev(): number {
        return this.history.getCurrentRev()
    }

    public getContent(): Change {
        return this.history.getContent()
    }

    public getContentAt(rev: number): Change {
        return this.history.getContentAt(rev)
    }

    public append(deltas: Change[]): number {
        return this.history.append(deltas)
    }

    public merge(baseRev: number, deltas: Change[]):SyncResponse {
        return this.history.merge({ rev: baseRev, branchName: '$simulate$', deltas })
    }

    public getChange(rev: number): Change[] {
        return this.history.getChange(rev)
    }

    public getChangesFrom(fromRev: number): Change[] {
        return this.history.getChangesFrom(fromRev)
    }

    public getChangesFromTo(fromRev: number, toRev: number): Change[] {
        return this.history.getChangesFromTo(fromRev, toRev)
    }

    // returns {offset, excerpt}
    public getFullExcerpts(): Array<{offset: number, excerpt: Excerpt}> {
        const excerptMarkers:ExcerptMarkerWithOffset[] = []
        const excerptMap = new Map<string, ExcerptMarker>()
        let offset = 0
        const content = this.getContent()
        for(const op of content.ops)
        {
            if(!op.insert)
                throw new Error('content is in invalid state: ' + JSONStringify(op))

            if(typeof op.insert === 'string')
            {
                offset += op.insert.length
            }
            else {
                if(ExcerptUtil.isExcerptMarker(op)) {
                    const excerptedOp:ExcerptMarker = op as ExcerptMarker
                    const targetInfo = {uri:excerptedOp.attributes.targetUri, rev:excerptedOp.attributes.targetRev}
                    const key = excerptedOp.insert.excerpted + "/" + JSONStringify(targetInfo)
                    if(excerptedOp.attributes.markedAt === 'left') {
                        excerptMap.set(key, excerptedOp)
                    }
                    else if(excerptedOp.attributes.markedAt === 'right') {
                        if(excerptMap.has(key)) {
                            const marker = excerptMap.get(key)!
                            if(marker.attributes.targetUri === excerptedOp.attributes.targetUri &&
                                marker.attributes.targetRev === excerptedOp.attributes.targetRev)
                                excerptMarkers.push({offset, ...excerptedOp})
                        }
                    }

                }
                offset ++ // all embeds have length of 1
            }
        }

        return excerptMarkers.map(marker => {
            return {offset: marker.offset, excerpt: ExcerptUtil.decomposeMarker(marker)}
        })
    }

    // returns {offset, insert, attributes}
    public getPartialExcerpts(): ExcerptMarkerWithOffset[] {
        const fullExcerpts = new Set<string>() // A ^ B
        const anyExcerpts = new Map<string, any>() // A U B
        let offset = 0
        const content = this.getContent()
        for(const op of content.ops)
        {
            if(!op.insert)
                throw new Error('content is in invalid state: ' + JSONStringify(op))

            if(typeof op.insert === 'string')
            {
                offset += op.insert.length
            }
            else {
                if(ExcerptUtil.isExcerptMarker(op)) {
                    const excerptedOp:any = op
                    const targetInfo = {uri:excerptedOp.attributes.targetUri, rev:excerptedOp.attributes.targetRev}
                    const key = excerptedOp.insert.excerpted + "/" + JSONStringify(targetInfo)

                    if(excerptedOp.attributes.markedAt === 'left') {
                        anyExcerpts.set(key, {offset, ...op})
                    }
                    else if(excerptedOp.attributes.markedAt === 'right') {
                        if(anyExcerpts.has(key)) {
                            const marker = anyExcerpts.get(key)!
                            if(marker.attributes.targetUri === excerptedOp.attributes.targetUri &&
                                marker.attributes.targetRev === excerptedOp.attributes.targetRev)
                                fullExcerpts.add(key)
                        }
                        anyExcerpts.set(key, {offset, ...op})
                    }
                }
                offset ++ // all embeds have length of 1
            }
        }
        const partialExcerpts:ExcerptMarkerWithOffset[] = []
        for(const key of Array.from(anyExcerpts.keys())) {
            if(!fullExcerpts.has(key))
                partialExcerpts.push(anyExcerpts.get(key))
        }

        return partialExcerpts
    }

    public takeExcerpt(start: number, end: number): ExcerptSource {
        const croppedContent = this.take(start, end)
        const safeCroppedContent = {...croppedContent, ops: ExcerptUtil.setExcerptMarkersAsCopied(croppedContent.ops)}
        expectEqual(contentLength(safeCroppedContent), end - start)
        return new ExcerptSource(this.name, this.history.getCurrentRev(), start, end, safeCroppedContent)
    }

    public takeExcerptAt(rev: number, start: number, end: number): ExcerptSource {
        const croppedContent = this.takeAt(rev, start, end)
        const safeCroppedContent = {...croppedContent, ops: ExcerptUtil.setExcerptMarkersAsCopied(croppedContent.ops)}
        expectEqual(contentLength(safeCroppedContent), end - start)
        return new ExcerptSource(this.name, rev, start, end, safeCroppedContent)
    }

    public take(start:number, end:number):Change {
        const content = this.history.getContent()
        return cropContent(content, start, end)
    }

    public takeAt(rev:number, start:number, end:number):Change {
        const content = this.history.getContentAt(rev)
        return cropContent(content, start, end)
    }

    public pasteExcerpt(offset: number, source: ExcerptSource, check=false): Excerpt {
        const rev = this.getCurrentRev() + 1
        const target = new ExcerptTarget(this.name, rev, offset, offset + contentLength(source.content)+1)

        const pasted = ExcerptUtil.getPasteWithMarkers(source, this.name, rev, offset)
        expectEqual(source.content, cropContent(pasted, 1, contentLength(pasted) - 1))

        const ops: Op[] = [{ retain: offset }]
        const change = new ExDelta(ops.concat(pasted.ops))
        this.history.append([change])
        // expectEqual([change], this.history.getChange(this.history.getCurrentRev()-1))

        // check
        if(check)
        {
            const leftMarker = this.take(target.start, target.start+1)
            const rightMarker = this.take(target.end, target.end+1)

            if(leftMarker.ops.length !== 1 || !ExcerptUtil.isLeftExcerptMarker(leftMarker.ops[0]))
                throw new Error('left marker check failed: L:' + JSONStringify(leftMarker) + " |R: " + JSONStringify(rightMarker) + ", " + JSONStringify(this.getContentAt(target.rev)))
            if(rightMarker.ops.length !== 1  || !ExcerptUtil.isRightExcerptMarker(rightMarker.ops[0]))
                throw new Error('right marker check failed: L:' + JSONStringify(leftMarker) + " |R: " + JSONStringify(rightMarker) + ", " + JSONStringify(this.getContentAt(target.rev)))

            expectEqual(ExcerptUtil.decomposeMarker(leftMarker.ops[0]).target, target)
            expectEqual(ExcerptUtil.decomposeMarker(rightMarker.ops[0]).target, target)
        }

        return new Excerpt(source, target)
    }

    public getSyncSinceExcerpted(source: Source): ExcerptSync[] {
        const uri = source.uri
        const lastRev = this.getCurrentRev()
        const initialRange = new Range(source.start, source.end)
        const changes = this.getChangesFrom(source.rev)
        const croppedChanges = initialRange.cropChanges(changes)
        const safeCroppedÇhanges = croppedChanges.map(croppedChange => ({...croppedChange, ops: ExcerptUtil.setExcerptMarkersAsCopied(croppedChange.ops)}))

        let sourceRev = source.rev
        const safeCroppedÇhangesWithSource = safeCroppedÇhanges.map(change => ({...change, source: [{uri, rev: sourceRev++}]}))
        const rangesTransformed = initialRange.mapChanges(changes)

        return this.composeSyncs(uri, lastRev, safeCroppedÇhangesWithSource, rangesTransformed)
    }

    public getSingleSyncSinceExcerpted(source: ExcerptSource): ExcerptSync[] {
        const uri = source.uri
        const rev = source.rev + 1
        const initialRange = new Range(source.start, source.end)
        const changes = this.getChangesFromTo(source.rev, source.rev) // only 1 change
        const croppedChanges = initialRange.cropChanges(changes)
        const safeCroppedÇhanges = croppedChanges.map(croppedChange => ({...croppedChange, ops: ExcerptUtil.setExcerptMarkersAsCopied(croppedChange.ops)}))
        let sourceRev = source.rev
        const safeCroppedÇhangesWithSource = safeCroppedÇhanges.map(change => ({...change, source: [{uri, rev: sourceRev++}]}))
        const rangesTransformed = initialRange.mapChanges(changes)
        return this.composeSyncs(uri, rev, safeCroppedÇhangesWithSource, rangesTransformed)
    }

    // update markers up-to-date at target
    public updateExcerptMarkers(target:ExcerptTarget, newSource?:Source, check = true, revive=false):ExcerptTarget {
        let full:Array<{
            offset: number;
            excerpt: Excerpt;
        }> = []
        // check if the target correctly holds the markers at old revision (must)
        if(check)
        {
            full = this.getFullExcerpts()
            const leftMarker = this.takeAt(target.rev, target.start, target.start+1)
            const rightMarker = this.takeAt(target.rev, target.end, target.end+1)
            if(leftMarker.ops.length !== 1 || !ExcerptUtil.isLeftExcerptMarker(leftMarker.ops[0]))
                throw new Error('left marker check failed:' + JSONStringify(leftMarker))
            if(rightMarker.ops.length !== 1  || !ExcerptUtil.isRightExcerptMarker(rightMarker.ops[0]))
                throw new Error('right marker check failed:' + JSONStringify(rightMarker) + ", " + JSONStringify(this.getContentAt(target.rev)))

            expectEqual(ExcerptUtil.decomposeMarker(leftMarker.ops[0]).target, target)
            expectEqual(ExcerptUtil.decomposeMarker(rightMarker.ops[0]).target, target)
        }

        if(target.rev === this.getCurrentRev())
            return target

        // getChanges since target.rev
        const changes = this.getChangesFrom(target.rev)
        const range = new Range(target.start, target.end)
        // FIXME: implement and utilize applyChange close, open
        const tmpRange = new Range(range.start, range.end+1).applyChanges(changes)
        const newRange = new Range(tmpRange.start, tmpRange.end-1)
        let reviveLeft = false
        let reviveRight = false
        // check if the target holds the markers at new revision. if not, throw
        // this assumes the target is not synced previously. only altered by user interaction, etc.
        // this assumption comes from the target should always come from current revision directly
        if(check || revive)
        {
            const leftMarker = this.take(newRange.start, newRange.start+1)
            const rightMarker = this.take(newRange.end, newRange.end+1)
            if(leftMarker.ops.length !== 1
                 || !ExcerptUtil.isLeftExcerptMarker(leftMarker.ops[0])
                 || !isEqual(ExcerptUtil.decomposeMarker(leftMarker.ops[0]).target, target)) {
                if(revive)
                    reviveLeft = true
                else if(check)
                    throw new Error('left marker check failed:' + JSONStringify(leftMarker))
            }

            if(rightMarker.ops.length !== 1
                 || !ExcerptUtil.isRightExcerptMarker(rightMarker.ops[0])
                 || !isEqual(ExcerptUtil.decomposeMarker(rightMarker.ops[0]).target, target)) {
                if(revive)
                    reviveRight = true
                else if(check)
                    throw new Error('right marker check failed:' + JSONStringify(rightMarker))
            }

            if(reviveLeft && reviveRight) {
                throw new Error('marker not found')
            }
        }

        const marker = this.take(newRange.start, newRange.start+1)
        const {source, } = ExcerptUtil.decomposeMarker(marker.ops[0])
        if(newSource) {
            expectEqual(source.uri, newSource.uri)
        }
        else
            newSource = source

        // apply changes
        const newTarget = new ExcerptTarget(target.uri, this.getCurrentRev() + 1, newRange.start, newRange.end)
        const leftExcerptMarker = ExcerptUtil.makeExcerptMarker('left', newSource.uri, newSource.rev, newSource.start, newSource.end, target.uri, newTarget.rev, newTarget.start, newTarget.end)
        const rightExcerptMarker = ExcerptUtil.makeExcerptMarker('right', newSource.uri, newSource.rev, newSource.start, newSource.end, target.uri, newTarget.rev, newTarget.start, newTarget.end)
        const excerptMarkerReplaceChange = {ops:[
            {retain: newTarget.start},
            {delete: reviveLeft ? 0 : 1},
            leftExcerptMarker,
            {retain: newTarget.end-newTarget.start-1},
            {delete: reviveRight ? 0 : 1},
            rightExcerptMarker]}

        this.append([excerptMarkerReplaceChange])

        // check again
        if(check)
        {
            const leftMarker = this.take(newRange.start, newRange.start+1)
            const rightMarker = this.take(newRange.end, newRange.end+1)
            if(leftMarker.ops.length !== 1 || !ExcerptUtil.isLeftExcerptMarker(leftMarker.ops[0]))
                throw new Error('left marker check failed:' + JSONStringify(leftMarker))
            if(rightMarker.ops.length !== 1  || !ExcerptUtil.isRightExcerptMarker(rightMarker.ops[0]))
                throw new Error('right marker check failed:' + JSONStringify(rightMarker))

            if(!isEqual(ExcerptUtil.decomposeMarker(leftMarker.ops[0]).target, newTarget))
                throw new Error('left marker check failed')
            if(!isEqual(ExcerptUtil.decomposeMarker(rightMarker.ops[0]).target, newTarget))
                throw new Error('right marker check failed')

            if(!isEqual(this.getFullExcerpts().length, full.length))
                throw new Error('number of excerpts shoudn\'t change')
        }

        return newTarget
    }

    public syncExcerpt(syncs: ExcerptSync[], initialTarget: ExcerptTarget, check=true): ExcerptTarget {

        let full:Array<{
            offset: number;
            excerpt: Excerpt;
        }> = []

        if(check)
            full = this.getFullExcerpts()

        // 1. merge sync
        const shiftedChanges = syncs.map(sync => {
            const change = sync.change
            // shift
            const shiftedChange = this.changeShifted(change, initialTarget.start+1)
            // add source info
            const source = [{uri: sync.uri, rev: sync.rev}]
            const shiftedChangeWithSource = {...shiftedChange, source}
            return shiftedChangeWithSource
        })

        this.merge(initialTarget.rev, shiftedChanges)

        // 2. update marker
        let target:ExcerptTarget
        if(syncs.length > 0) {
            const last = syncs[syncs.length-1]
            const newSource:Source = {
                uri: last.uri,
                rev: last.rev,
                start: last.range.start,
                end: last.range.end,
                type: 'sync'
            }
            target = this.updateExcerptMarkers(initialTarget, newSource)
        }
        else {
            target = this.updateExcerptMarkers(initialTarget)
        }

        if(check)
        {
            const leftMarker = this.take(target.start, target.start+1)
            const rightMarker = this.take(target.end, target.end+1)

            if(leftMarker.ops.length !== 1 || !ExcerptUtil.isLeftExcerptMarker(leftMarker.ops[0]))
                throw new Error('left marker check failed: l: ' + JSONStringify(leftMarker) + " |r: " + JSONStringify(rightMarker) + " |T: " + JSONStringify(target) + " |C: " + JSONStringify(this.getContent()) + " |S: " + JSONStringify(shiftedChanges))
            if(rightMarker.ops.length !== 1  || !ExcerptUtil.isRightExcerptMarker(rightMarker.ops[0]))
                throw new Error('right marker check failed: l: ' + JSONStringify(leftMarker) + " |r: " + JSONStringify(rightMarker) + " |T: " + JSONStringify(target) + " |C: "  + JSONStringify(this.getContent()) +  " |S: " + JSONStringify(shiftedChanges))

            expectEqual(ExcerptUtil.decomposeMarker(leftMarker.ops[0]), ExcerptUtil.decomposeMarker(rightMarker.ops[0]))
            // may change on revived lost marker present
            // if(!isEqual(this.getFullExcerpts().length, full.length))
            //     throw new Error('number of excerpts shoudn\'t change')
        }

        return new ExcerptTarget(this.name, this.getCurrentRev(), target.start, target.end)
    }

    /** private methods */

    private undoAt(rev:number) {
        if(rev <= 0 || rev > this.getCurrentRev())
            throw new Error('invalid argument: ' + rev)

        const content = this.getContentAt(rev-1)
        const change = this.getChange(rev)
        const undoChange = reverseChange(content, change[0])
        this.merge(rev-1, [undoChange])
    }

    private changeShifted(change: Change, offset:number):Change {
        const shiftAmount = offset
        change = new ExDelta(change.ops, change.source)
        // adjust offset:
        // utilize first retain if it exists
        if (change.ops.length > 0 && change.ops[0].retain) {
            change.ops[0].retain! += shiftAmount
        // otherwise just append new retain
        } else {
            change.ops.unshift({ retain: shiftAmount })
        }
        return change
    }

    private composeSyncs(uri:string, lastRev:number, changes:Change[], ranges:Range[]) {
        if(changes.length !== ranges.length)
            throw new Error("Unexpected error in composeSyncs: " + JSONStringify(changes) + ", " + JSONStringify(ranges))

        const syncs:ExcerptSync[] = []
        let rev = lastRev - changes.length + 1
        for(let i = 0; i < changes.length; i++, rev++) {
            syncs.push({ uri, rev, change: changes[i], range: ranges[i] })
        }
        return syncs
    }
}