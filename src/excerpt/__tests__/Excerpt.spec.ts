import * as chalk from 'chalk'
import each from 'jest-each'
import Delta = require('quill-delta')
import * as _ from 'underscore'
import { Document } from '../../document/Document'
import {printChange, printContent, printChangedContent, printChanges} from '../../primitive/printer'
import { contentLength, JSONStringify, normalizeOps, expectEqual } from '../../primitive/util'
import { ExDelta } from '../../primitive/ExDelta';
import { Source } from '../../primitive/Source';

describe('Excerpt', () => {

    it('Document crop', () => {
        const doc1 = new Document('doc1', 'My Document 1')
        const doc2 = new Document('doc2', 'Here comes the trouble. HAHAHAHA')

        const doc1Changes = [new ExDelta([]).delete(3).insert('Your '), new Delta().retain(5).insert('precious ')]

        const doc2Changes = [new Delta().insert('Some introduction here: ')]
        doc1.append(doc1Changes)
        doc2.append(doc2Changes)

        expectEqual(
            JSONStringify(doc1.takeAt(0, 0, 2)),
            JSONStringify({ ops: [{ insert: 'My' }] })
        )

        expectEqual(
            JSONStringify(doc1.takeAt(1, 0, 4)),
            JSONStringify({ ops: [{ insert: 'Your' }] })
        )

        expectEqual(
            JSONStringify(doc1.takeAt(2, 0, 4)),
            JSONStringify({ ops: [{ insert: 'Your' }] })
        )

        expectEqual(
            JSONStringify(doc1.takeAt(2, 5, 9)),
            JSONStringify({ ops: [{ insert: 'prec' }] })
        )

        expectEqual(
            JSONStringify(doc1.take(0, 4)),
            JSONStringify({ ops: [{ insert: 'Your' }] })
        )

    })

    it('Document excerpt', () => {
        const doc1 = new Document('doc1', 'My Document 1')
        const doc2 = new Document('doc2', 'Here comes the trouble. HAHAHAHA')

        const doc1Changes = [new Delta().delete(3).insert('Your '), new Delta().retain(5).insert('precious ')] // Your precious Document 1

        const doc2Changes = [new Delta().insert('Some introduction here: ')] // Some introduction here: Here comes ...
        doc1.append(doc1Changes)
        doc2.append(doc2Changes)

        const source1 = doc1.takeExcerpt(0, 4) // Your
        expectEqual(
            JSONStringify(source1),
            JSONStringify({ uri: 'doc1', rev: 2, start: 0, end: 4, content: { ops: [{ insert: 'Your' }] }, type: 'excerpt' }),
        )

        const excerpt = doc2.pasteExcerpt(5, source1)
        expectEqual(JSONStringify(excerpt.target), JSONStringify({ uri: "doc2", rev: 2, start: 5, end: 10 }))

        expectEqual(
            JSONStringify(doc2.getContent().ops),
            JSONStringify([{"insert":"Some "},{"insert":{"excerpted":"doc1?rev=2&start=0&end=4"},"attributes":{"markedAt":"left", "targetUri":"doc2","targetRev":"2","targetStart":"5", "targetEnd":"10"}},{"insert":"Your"}, {"insert":{"excerpted":"doc1?rev=2&start=0&end=4"},"attributes":{"markedAt":"right", "targetUri":"doc2","targetRev":"2","targetStart":"5", "targetEnd":"10"}}, {"insert": "introduction here: Here comes the trouble. HAHAHAHA"}])
        )
    })

    each([[false],[true]]).it('Document sync', (method) => {
        const doc1 = new Document('doc1', 'My Document 1')
        const doc2 = new Document('doc2', 'Here comes the trouble. HAHAHAHA')

        const doc1Changes = [
            new Delta([{ delete: 3 }, { insert: 'Your ' }]),
            new Delta([{ retain: 5 }, { insert: 'precious ' }]), // Your precious Document 1
        ]

        const doc2Changes = [
            new Delta().insert('Some introduction here: '), // Some introduction here: Here comes the trouble. HAHAHAHA
        ]

        const doc1ChangesAfterExcerpt = [
            new Delta([{ insert: "No, It's " }, { delete: 4 }, { insert: 'Our' }]), // +8, No, it's Our
            new Delta([{ retain: 13 + 8 }, { insert: ' beautiful ' }, { delete: 1 }]),
            new Delta([{ retain: 13 }, { insert: 'delicious ' }]),
            new Delta([{ retain: 16 }, { insert: 'ete' }, { delete: 6 }]),
        ]

        const doc2ChangesAfterExcerpt = [
            new Delta([{ delete: 4 }, { insert: 'Actual' }]),
            new Delta([{ retain: 11 }, { insert: 'tty' }, { delete: 5 }]), // Actual pre|tty|cious
            new Delta([{ retain: 11 }, { insert: 'ttier' }, { delete: 3 }]),
        ]


        doc1.append(doc1Changes)
        doc2.append(doc2Changes)

        console.log('phases1.doc1: ', printContent(doc1.getContent()))
        console.log('phases1.doc2: ', printContent(doc2.getContent()))

        const source1 = doc1.takeExcerpt(5, 14) // 'precious '
        console.log('sourceInfo:', JSONStringify(source1))

        const excerpt1 = doc2.pasteExcerpt(5, source1) // Some precious introduction here: ...'
        const target1 = excerpt1.target
        console.log('targetInfo:', JSONStringify(target1))

        console.log('phases2.doc2: ', printContent(doc2.getContent()))

        const doc1Content = doc1.getContent()
        const doc2Content = doc2.getContent()
        doc1.append(doc1ChangesAfterExcerpt)
        doc2.append(doc2ChangesAfterExcerpt)

        console.log('phases2.doc1 changes: ', printChangedContent(doc1Content, doc1ChangesAfterExcerpt))
        console.log('phases2.doc2 changes: ', printChangedContent(doc2Content, doc2ChangesAfterExcerpt))

        console.log('phases3.doc1: ', doc1.getCurrentRev(), printContent(doc1.getContent()))
        console.log('phases3.doc2: ', doc2.getCurrentRev(), printContent(doc2.getContent()))


        console.log('phases4.target: ', JSONStringify(target1))
        console.log('phases4.source: ', JSONStringify(source1))

        // method 1
        if (method) {
            const syncs = doc1.getSyncSinceExcerpted(source1)
            console.log('phases4.sync: ', JSONStringify(syncs))
            const target2 = doc2.syncExcerpt(syncs, target1)
            expectEqual(doc2.getContent(),
                {"ops":[{"insert":"Actual "},
                {"insert":{"excerpted":"doc1?rev=6&start=20&end=39"},"attributes":{"markedAt": "left", "targetUri":"doc2","targetRev":"10","targetStart":"7", "targetEnd":"27"}},
                {"insert":"prettier beautiful "},
                {"insert":{"excerpted":"doc1?rev=6&start=20&end=39"},"attributes":{"markedAt":"right","targetUri":"doc2","targetRev":"10","targetStart":"7","targetEnd":"27"}},
                 {"insert": "introduction here: Here comes the trouble. HAHAHAHA"}]})
            console.log('Sync changes: ', JSONStringify(doc2.getChangesFrom(target1.rev)))
            console.log('phases4.doc2: ', doc2.getCurrentRev(), printContent(doc2.getContent()))
        }
        // method2
        else {
            let source = source1
            let target = target1
            while (source.rev < doc1.getCurrentRev()) {
                const syncs = doc1.getSingleSyncSinceExcerpted(source)
                if(syncs.length == 0)
                    break
                const sync = syncs[0]
                target = doc2.syncExcerpt(syncs, target)
                source = doc1.takeExcerptAt(sync.rev, sync.range.start, sync.range.end)
                console.log('phases4.sync: ', JSONStringify(syncs))
                console.log('phases4.target: ', JSONStringify(target))
                console.log('phases4.source: ', JSONStringify(source))
                console.log('phases4.doc2: ', doc2.getCurrentRev(), printContent(doc2.getContent()))
            }
            expectEqual(doc2.getContent(), {"ops":[{"insert":"Actual "},{"insert":{"excerpted":"doc1?rev=6&start=20&end=39"},"attributes":{"markedAt":"left","targetUri":"doc2","targetRev":"13","targetStart":"7","targetEnd":"27"}},{"insert":"prettier beautiful "},{"insert":{"excerpted":"doc1?rev=6&start=20&end=39"},"attributes":{"markedAt":"right","targetUri":"doc2","targetRev":"13","targetStart":"7","targetEnd":"27"}},{"insert":"introduction here: Here comes the trouble. HAHAHAHA"}]})
            console.log('Sync changes: ', JSONStringify(doc2.getChangesFrom(target1.rev)))
        }
    })

    it('TODO: Overlapping excerpt', () => {
        const doc1 = new Document('doc1', 'aaaa')
        const doc2 = new Document('doc2', 'bbbb')

        const e1 = doc1.takeExcerpt(1, 3)
        const d1 = doc2.pasteExcerpt(1, e1)

        const e2 = doc2.takeExcerpt(1, 3)
        const d2 = doc1.pasteExcerpt(3, e2)

        console.log(JSONStringify(e1))
        console.log(JSONStringify(e2))

        console.log(printContent(doc1.getContent()))
        console.log(printContent(doc2.getContent()))

        const doc1Changes = [
            new Delta([{ delete: 1 }, { insert: 'A' }]),
            // new Delta([{ retain: 1 }, { insert: '1' }]),
            // new Delta([{ retain: 2 }, { insert: '1' }]),
        ]

        const doc2Changes = [new Delta([{ insert: 'B' }])]
        doc1.append(doc1Changes)
        doc2.append(doc2Changes)

        console.log(printContent(doc1.getContent()))
        console.log(printContent(doc2.getContent()))

        const target = doc2.updateExcerptMarkers(d1.target)

        console.log(printContent(doc1.getContent()))
        console.log(printContent(doc2.getContent()))

        const s1 = doc1.getSyncSinceExcerpted(e1)
        doc2.syncExcerpt(s1, target)

        console.log(printContent(doc1.getContent()))
        console.log(printContent(doc2.getContent()))
    })
})


describe('Mutual Excerpts', () => {
    it('Same doc', () => {
        const doc1 = new Document("doc1", "ab")
        const source1 = doc1.takeExcerpt(0,2)
        doc1.pasteExcerpt(2, source1) // (ab)[ab]
        expectEqual(doc1.getContent(), {"ops":[
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=0&start=0&end=2"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"1","targetStart":"2","targetEnd":"5"}},
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=0&start=0&end=2"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"1","targetStart":"2","targetEnd":"5"}}
        ]})
        const source2 = doc1.takeExcerpt(3,5)
        doc1.pasteExcerpt(1, source2) // a[ab]b(ab)
        expectEqual(doc1.getContent(), {"ops":[
            {"insert":"a"},
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4"}},
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4"}},
            {"insert":"b"},
            {"insert":{"excerpted":"doc1?rev=0&start=0&end=2"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"1","targetStart":"2","targetEnd":"5"}},
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=0&start=0&end=2"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"1","targetStart":"2","targetEnd":"5"}}
        ]})

        const excerpt2 = doc1.getFullExcerpts()[1].excerpt
        const syncs2 = doc1.getSyncSinceExcerpted(excerpt2.source)
        // check source of change
        expectEqual(syncs2[0].change.source[0].rev, excerpt2.source.rev)

        doc1.syncExcerpt(syncs2, excerpt2.target) // {a(ab)b}{a[ab]b} : sync right excerpt (from left pasted)
        expectEqual(doc1.getContent(),  {"ops":[
            {"insert":"a"},
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4"}},
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4"}},
            {"insert":"b"},
            // synced 'ab' (source marked)
            {"insert":{"excerpted":"doc1?rev=2&start=0&end=6"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"5","targetStart":"6","targetEnd":"13"}},
            {"insert":"a"},
            //
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
            {"insert":"ab"},
            {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
            //
            {"insert":"b"},
            {"insert":{"excerpted":"doc1?rev=2&start=0&end=6"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"5","targetStart":"6","targetEnd":"13"}}
        ]})

        const path = 0
        // TODO

        // sync left excerpt (from right recently synced left)
        if(path === 0) {
            // sync: change source (right) and then sync
            // sync: or sync first and then changed
            // should skip sync applied previously
            //aabba(c)a-b-(d)b
            doc1.append([{ops: [{retain:8}, {insert:'c'}]}])
            // expectEqual(doc1.getContent(), '')
            // if a sync source change has 'source' field:
                // and source field uri, rev <= excerpt's target field uri, rev
                    // skip that sync change
        }
        else {
            const excerpt1 = doc1.getFullExcerpts()[0].excerpt
            const syncs1 = doc1.getSyncSinceExcerpted(excerpt1.source)
            // expectEqual(syncs1, '')
            doc1.syncExcerpt(syncs1, excerpt1.target) // a{a[ab]b}b{a(ab)b}
            // if a sync source change has 'source' field:
                // and source field uri, rev <= excerpt's target field uri, rev
                    // skip that sync change
            expectEqual(doc1.getContent(),  {"ops":[
                {"insert":"a"},
                {"insert":{"excerpted":"doc1?rev=5&start=7&end=13"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"10","targetStart":"1","targetEnd":"8"}},
                // added
                {"insert":"a"},
                {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
                {"insert":"ab"},
                {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
                {"insert":"b"},
                // ~added
                {"insert":{"excerpted":"doc1?rev=5&start=7&end=13"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"10","targetStart":"1","targetEnd":"8"}},
                {"insert":"b"},
                //
                {"insert":{"excerpted":"doc1?rev=2&start=0&end=6"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"5","targetStart":"6","targetEnd":"13"}},
                {"insert":"a"},
                {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"left","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
                {"insert":"ab"},
                {"insert":{"excerpted":"doc1?rev=1&start=3&end=5"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"2","targetStart":"1","targetEnd":"4","copied":"true"}},
                {"insert":"b"},
                {"insert":{"excerpted":"doc1?rev=2&start=0&end=6"},"attributes":{"markedAt":"right","targetUri":"doc1","targetRev":"5","targetStart":"6","targetEnd":"13"}}
            ]})
        }

    })
})
