const {
  Transaction, MerkleBlock, InstantLock,
} = require('@dashevo/dashcore-lib');

const Worker = require('../../Worker');

class TransactionSyncStreamWorker extends Worker {
  constructor(options) {
    super({
      name: 'TransactionSyncStreamWorker',
      executeOnStart: true,
      firstExecutionRequired: true,
      workerIntervalTime: 0,
      gapLimit: 10,
      dependencies: [
        'importTransactions',
        'importBlockHeader',
        'importInstantLock',
        'storage',
        'transport',
        'walletId',
        'getAddress',
        'network',
        'index',
        'BIP44PATH',
        'walletType',
      ],
      ...options,
    });

    this.syncIncomingTransactions = false;
    this.stream = null;
    this.incomingSyncPromise = null;
  }

  /**
   * Filter transaction based on the address list
   * @param {Transaction[]} transactions
   * @param {string[]} addressList
   * @param {string} network
   */
  static filterWalletTransactions(transactions, addressList, network) {
    const spentOutputs = [];
    const unspentOutputs = [];
    const filteredTransactions = transactions.filter((tx) => {
      let isWalletTransaction = false;

      tx.inputs.forEach((input) => {
        if (input.script) {
          const addr = input.script.toAddress(network).toString();
          if (addressList.includes(addr)) {
            spentOutputs.push(input);
            isWalletTransaction = true;
          }
        }
      });

      tx.outputs.forEach((output) => {
        const addr = output.script.toAddress(network).toString();
        if (addressList.includes(addr)) {
          unspentOutputs.push(output);
          isWalletTransaction = true;
        }
      });

      return isWalletTransaction;
    });

    return {
      transactions: filteredTransactions,
      spentOutputs,
      unspentOutputs,
    };
  }

  /**
   *
   * @param {TransactionsWithProofsResponse} response
   * @return {[]}
   */
  static getMerkleBlockFromStreamResponse(response) {
    let merkleBlock = null;
    const rawMerkleBlock = response.getRawMerkleBlock();
    if (rawMerkleBlock) {
      merkleBlock = new MerkleBlock(Buffer.from(rawMerkleBlock));
    }
    return merkleBlock;
  }

  /**
   *
   * @param response
   * @return {[]}
   */
  static getTransactionListFromStreamResponse(response) {
    let walletTransactions = [];
    const transactions = response.getRawTransactions();

    if (transactions) {
      walletTransactions = transactions
        .getTransactionsList()
        .map((rawTransaction) => new Transaction(Buffer.from(rawTransaction)));
    }

    return walletTransactions;
  }

  static getInstantSendLocksFromResponse(response) {
    let walletTransactions = [];
    const instantSendLockMessages = response.getInstantSendLockMessages();

    if (instantSendLockMessages) {
      walletTransactions = instantSendLockMessages
        .getMessagesList()
        .map((instantSendLock) => new InstantLock(Buffer.from(instantSendLock)));
    }

    return walletTransactions;
  }

  async onStart() {
    // Using sync options here to avoid
    // situation when plugin is injected directly
    // instead of usual injection process
    const {
      skipSynchronizationBeforeHeight,
    } = (this.storage.store.syncOptions || {});

    if (skipSynchronizationBeforeHeight) {
      const header = await this.transport.getBlockHeaderByHeight(skipSynchronizationBeforeHeight);
      const { hash } = header;

      this.setLastSyncedBlockHeight(
        skipSynchronizationBeforeHeight,
      );
      this.setLastSyncedBlockHash(
        hash,
      );
    }

    // We first need to sync up initial historical transactions
    await this.startHistoricalSync(this.network);
  }

  /**
   * This is executed only once on start up.
   * So we will maintain our ongoing stream during the whole execution of the wallet
   *
   * @returns {Promise<void>}
   */
  async execute() {
    this.syncIncomingTransactions = true;
    // We shouldn't block workers execution process with transaction syncing
    // it should proceed in background

    // noinspection ES6MissingAwait
    this.incomingSyncPromise = this.startIncomingSync();
  }

  async onStop() {
    this.syncIncomingTransactions = false;

    if (this.stream) {
      this.stream.cancel();
      // When calling stream.cancel(), the stream will emit 'error' event with the code 'CANCELLED'.
      // There are two cases when this happens: when the gap limit is filled and syncToTheGapLimit
      // and the stream needs to be restarted with new parameters, and here,
      // when stopping the worker.
      // The code in stream worker distinguishes whether it need to reconnect or not by the fact
      // that the old stream object is present or not. When it is set to null, it won't try to
      // reconnect to the stream.
      this.stream = null;
    }
  }
}

TransactionSyncStreamWorker.prototype.getAddressesToSync = require('./methods/getAddressesToSync');
TransactionSyncStreamWorker.prototype.getBestBlockHeightFromTransport = require('./methods/getBestBlockHeight');
TransactionSyncStreamWorker.prototype.setLastSyncedBlockHash = require('./methods/setLastSyncedBlockHash');
TransactionSyncStreamWorker.prototype.setLastSyncedBlockHeight = require('./methods/setLastSyncedBlockHeight');
TransactionSyncStreamWorker.prototype.getLastSyncedBlockHash = require('./methods/getLastSyncedBlockHash');
TransactionSyncStreamWorker.prototype.getLastSyncedBlockHeight = require('./methods/getLastSyncedBlockHeight');
TransactionSyncStreamWorker.prototype.startHistoricalSync = require('./methods/startHistoricalSync');
TransactionSyncStreamWorker.prototype.startIncomingSync = require('./methods/startIncomingSync');
TransactionSyncStreamWorker.prototype.syncUpToTheGapLimit = require('./methods/syncUpToTheGapLimit');

module.exports = TransactionSyncStreamWorker;
