import * as assert from 'assert'
import {removeUndefined} from '../../common'
import {parseMemos} from './utils'

export type FormattedCheckCancel = {
  // ID of the Check ledger object to cancel.
  checkID: string
}

function parseCheckCancel(tx: any): FormattedCheckCancel {
  assert.ok(tx.TransactionType === 'CheckCancel')

  return removeUndefined({
    memos: parseMemos(tx),
    checkID: tx.CheckID
  })
}

export default parseCheckCancel
