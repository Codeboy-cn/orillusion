import { test, expect, end } from '../util'
import { CEvent, CEventDispatcher } from '@orillusion/core';

// Regression tests for audit findings P3 / P6 / P8 (batch 2).

await test('null-thisObject listeners dedupe and can be removed [audit P3]', async () => {
    let d = new CEventDispatcher();
    let count = 0;
    let cb = () => { count++; };

    d.addEventListener('probe', cb, null);
    d.addEventListener('probe', cb, null);
    d.addEventListener('probe', cb, null);
    d.dispatchEvent(new CEvent('probe'));
    // Used to fire 3 times: dedup was blind to thisObject=null.
    expect(count).toEqual(1);

    d.removeEventListener('probe', cb, null);
    d.dispatchEvent(new CEvent('probe'));
    // Used to stay registered forever: removal was unreachable.
    expect(count).toEqual(1);

    expect(d.hasEventListener('probe')).toEqual(false);
})

await test('removeAllEventListener disposes every listener [audit P6]', async () => {
    let d = new CEventDispatcher();
    let calls: number[] = [];
    let objs = [0, 1, 2, 3, 4, 5].map(i => ({ fn: () => { calls.push(i); } }));
    for (let o of objs) d.addEventListener('probe', o.fn, o);

    d.removeAllEventListener('probe');
    d.dispatchEvent(new CEvent('probe'));
    // Forward splice used to leave listeners 1/3/5 alive.
    expect(calls.length).toEqual(0);

    // Same via the remove-everything overload.
    calls = [];
    for (let o of objs) d.addEventListener('probe', o.fn, o);
    d.removeAllEventListener();
    d.dispatchEvent(new CEvent('probe'));
    expect(calls.length).toEqual(0);
})

await test('removeAll during dispatch stops later listeners [audit P6]', async () => {
    let d = new CEventDispatcher();
    let calls: number[] = [];
    let first = { fn: () => { calls.push(0); d.removeAllEventListener('probe'); } };
    let objs = [1, 2, 3, 4, 5].map(i => ({ fn: () => { calls.push(i); } }));

    d.addEventListener('probe', first.fn, first);
    for (let o of objs) d.addEventListener('probe', o.fn, o);

    d.dispatchEvent(new CEvent('probe'));
    // dispatch iterates a snapshot, but disposed listeners (handler=null)
    // must be skipped — odd-position survivors used to still fire.
    expect(calls.length).toEqual(1);
    expect(calls[0]).toEqual(0);
})

await test('same callback with different params registers separately [audit P8]', async () => {
    let d = new CEventDispatcher();
    let ctx = {};
    let seen: any[] = [];
    let cb = function (e: CEvent) { seen.push(e.param); };

    let id1 = d.addEventListener('probe', cb, ctx, 'a');
    let id2 = d.addEventListener('probe', cb, ctx, 'b');
    // Used to silently drop the second registration and return id 0.
    expect(id1 > 0).toEqual(true);
    expect(id2 > 0).toEqual(true);
    expect(id1 !== id2).toEqual(true);

    d.dispatchEvent(new CEvent('probe'));
    expect(seen.length).toEqual(2);
    expect(seen.indexOf('a') >= 0).toEqual(true);
    expect(seen.indexOf('b') >= 0).toEqual(true);

    // Exact re-registration still dedupes to the original id.
    let id3 = d.addEventListener('probe', cb, ctx, 'a');
    expect(id3).toEqual(id1);
})

setTimeout(end, 500)
