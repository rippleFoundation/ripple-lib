import assert from 'assert-diff'
import { TestSuite } from '../../utils'

/**
 * Every test suite exports their tests in the default object.
 * - Check out the "TestSuite" type for documentation on the interface.
 * - Check out "test/api/index.ts" for more information about the test runner.
 */
export default <TestSuite>{
  'default test': async (api, address) => {
    const ver = await api.getLedgerVersion()
    assert.strictEqual(ver, 8819951)
  }
}
