/**
 * Allows an asynchronous function to await for a completion in another asynchronous function.
 * See test below for example.
 */
export class EventWaiter {
    private _resolvePtr: Function;
    private _rejectPtr: Function;
    private _promise: Promise<void>;
    private _resolved = false;
    private _rejected = false;
    private _version = 0;

    /**
     * Constructs an instance of this class
     * @constructor
     */
    constructor() {
        // TODO: Drive version change from set or reject functions
        this.EventReset();
    }

    /**
     * This will reset the instance so that it is no longer complete. If a timeout is used with EventWait then the return value should be
     * passed to EventSet. This will prevent a EventSet setting the class after that event has already timed out.
     * @returns a unique number that can be used in EventSet
     */
    EventReset(): number {
        this._resolved = false;
        this._rejected = false;
        this._promise = new Promise((resolve, reject) => {
            this._resolvePtr = resolve;
            this._rejectPtr = reject;
        });
        return ++this._version;
    }

    /**
     * Waits for event completion. 
     * @param timeout Optional. The number of milliseconds to wait for completion. Default is forever.
     * @returns A void Promise to use with await
     */
    async EventWait(timeout?: number): Promise<void> {
        if (!timeout) {
            return this._promise;
        }
        else {
            // TODO: Don't return race, but reject when timer expires
            return Promise.race([
                this._promise,
                new Promise<void>((_resolve, reject) => setTimeout(() => reject(new Error('Timed out')), timeout)),
            ]);
        }
    }

    /**
     * 
     * @param version This value is returned by EventReset. Use it to ensure you set the current event rather than one that timed out.
     */
    EventSet(version?: number): void {
        if ((version && version == this._version) || !version) {
            this._resolved = true;
            this._resolvePtr();
        }
    }

    /**
     * Call when the action failed
     * @param err Cause the promise to be rejected
     */
    EventError(err?: any) {
        // TODO This should have a version parameter too
        this._rejected = true;
        this._rejectPtr(err);
    }

    /***
     * Returns true if the event is still pending
     */
    get EventIsPending(): boolean {
        return !(this._resolved || this._rejected);
    }

    /**
     * Returns true if the event has been resolved
     */
    get EventIsResolved(): boolean {
        return this._resolved;
    }

    /**
     * Returns true if the event has been rejected
     */
    get EventIsRejected(): boolean {
        return this._rejected;
    }
}
/*
async function test() {
    let ew = new EventWaiter();

    // Fails
    try {
        let version = ew.EventReset();
        console.log(`${new Date().toTimeString()} should fail`);
        setTimeout(() => ew.EventSet(version), 5100);
        await ew.EventWait(5000);
        console.log(new Date().toTimeString() + ' done')
    }
    catch (err) {
        console.error(new Date().toTimeString() + ' ' + err.message);
    }

    // Works
    try {
        let version = ew.EventReset();
        console.log(new Date().toTimeString() + ' should work');
        setTimeout(() => ew.EventSet(version), 4900);
        await ew.EventWait(5000);
        console.log(new Date().toTimeString() + ' done')
    }
    catch (err) {
        console.error(new Date().toTimeString() + ' ' + err.message);
    }

}

console.log(new Date().toTimeString() + ' start');
// test();
*/