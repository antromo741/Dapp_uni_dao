/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */
const { expect } = require('chai');
const { ethers } = require('hardhat');

const tokens = (n) => {
  return ethers.utils.parseUnits(n.toString(), 'ether')
}

const ether = tokens

describe('DAO', () => {
  let token, dao
  let deployer, funder, investor1, investor2, investor3, investor4, investor5, recipient, user

  beforeEach(async () => {
    // Set up accounts
    let accounts = await ethers.getSigners()
    deployer = accounts[0]
    funder = accounts[1]
    investor1 = accounts[2]
    investor2 = accounts[3]
    investor3 = accounts[4]
    investor4 = accounts[5]
    investor5 = accounts[6]
    recipient = accounts[7]
    user = accounts[8]
    // Deploy token
    const Token = await ethers.getContractFactory('Token')
    token = await Token.deploy('Dapp University', 'DAPP', '1000000')

    // Send tokens to investors - each one gets 20%
    transaction = await token.connect(deployer).transfer(investor1.address, tokens(200000))
    await transaction.wait()

    transaction = await token.connect(deployer).transfer(investor2.address, tokens(200000))
    await transaction.wait()

    transaction = await token.connect(deployer).transfer(investor3.address, tokens(200000))
    await transaction.wait()

    transaction = await token.connect(deployer).transfer(investor4.address, tokens(200000))
    await transaction.wait()

    transaction = await token.connect(deployer).transfer(investor5.address, tokens(200000))
    await transaction.wait()

    // Deploy DAO
    const DAO = await ethers.getContractFactory('DAO')
    dao = await DAO.deploy(token.address, '500000000000000000000001')

    // have funder send money to dao treasury
    await funder.sendTransaction({ to: dao.address, value: ether(100) })
  })

  describe('Deployment', () => {

    it('returns token address', async () => {
      expect(await dao.token()).to.equal(token.address)
    })

    it('returns quorum', async () => {
      expect(await dao.quorum()).to.equal('500000000000000000000001')
    })

    it('sends ether to the DAO treasury', async () => {
      expect(await ethers.provider.getBalance(dao.address)).to.equal(ether(100))
    })
  })

  describe('Propsal creation', () => {

    describe('Success', () => {
      beforeEach(async () => {
        transaction = await dao.connect(investor1).createProposal('Proposal 1', ether(100), recipient.address)
        result = await transaction.wait()
      })

      it('updates proposal count', async () => {
        expect(await dao.proposalCount()).to.equal(1)
      })

      it('updates proposal mapping', async () => {
        const proposal = await dao.proposals(1)

        expect(proposal.id).to.equal(1)
        expect(proposal.amount).to.equal(ether(100))
        expect(proposal.recipient).to.equal(recipient.address)
      })

      it('emits a propose event', async () => {
        await expect(transaction).to.emit(dao, "Propose").withArgs(1, ether(100), recipient.address, investor1.address)
      })


    })

    describe('Failure', () => {
      it('rejects invalid amount', async () => {
        await expect(dao.connect(investor1).createProposal('Proposal 1', ether(1000), recipient.address)).to.be.reverted
      })

      it('rejects non investor', async () => {
        await expect(dao.connect(user).createProposal('Proposal 1', ether(100), recipient.address)).to.be.reverted
      })

    })
  })

  describe('Voting', () => {
    let transaction, result
    beforeEach(async () => {
      transaction = await dao.connect(investor1).createProposal('Proposal 1', ether(100), recipient.address)
      result = await transaction.wait()
    })

    describe('Success', () => {
      beforeEach(async () => {
        transaction = await dao.connect(investor1).vote(1)
        result = await transaction.wait()

      })

      it('updates vote count', async () => {
        const proposal = await dao.proposals(1)
        expect(proposal.votes).to.equal(tokens(200000))
      })

      it('emits vote event', async () => {
        await expect(transaction).to.emit(dao, "Vote").withArgs(1, investor1.address)
      })
    })

    describe('Failure', () => {
      it('rejects non-investor', async () => {
        await expect(dao.connect(user).vote(1)).to.be.reverted
      })

      it('rejects double voting', async () => {
        transaction = await dao.connect(investor1).vote(1)
        await transaction.wait()

        await expect(dao.connect(investor1).vote(1)).to.be.reverted
      })
    })

  })


  describe('Governance', () => {
    let transaction, result

    describe('Success', () => {
      beforeEach(async () => {
        transaction = await dao.connect(investor1).createProposal('Proposal', ether(100), recipient.address)
        result = await transaction.wait()

        transaction = await dao.connect(investor1).vote(1)
        result = await transaction.wait()

        transaction = await dao.connect(investor2).vote(1)
        result = await transaction.wait()

        transaction = await dao.connect(investor3).vote(1)
        result = await transaction.wait()

        transaction = await dao.connect(investor1).finalizeProposal(1)
        result = await transaction.wait()
      })

      it('transfers funs to recipient', async () => {
        expect(await ethers.provider.getBalance(recipient.address)).to.equal(tokens(10100))
      })


      it('it updates the proposal to be finalized', async () => {
        const proposal = await dao.proposals(1)
        expect(proposal.finalized).to.equal(true)
      })

      it('emits a Finalize event', async () => {
        expect(transaction).to.emit(dao, "Finalize").withArgs(1)
      })
    })

    describe('Failure', () => {
      beforeEach(async () => {
        transaction = await dao.connect(investor1).createProposal('Proposal', ether(100), recipient.address)
        result = await transaction.wait()

        transaction = await dao.connect(investor1).vote(1)
        result = await transaction.wait()

        transaction = await dao.connect(investor2).vote(1)
        result = await transaction.wait()
      })

      it('rejects finalization if not enough votes', async () => {
        transaction = await dao.connect(investor3).vote(1)
        result = await transaction.wait()

        await expect(dao.connect(user).finalizeProposal(1)).to.be.reverted
      })

      it('rejects finalization from non investor', async () => {

        await expect(dao.connect(investor1).finalizeProposal(1)).to.be.reverted
      })

      it('rejects proposal if already finalized', async () => {
        transaction = await dao.connect(investor3).vote(1)
        result = await transaction.wait()

        transaction = await dao.connect(investor1).finalizeProposal(1)
        result = await transaction.wait()

        await expect(dao.connect(investor1).finalizeProposal(1)).to.reverted
      })

    })

  })

  describe('Refund Mechanism', () => {
    let transaction, result, initialBalance

    beforeEach(async () => {
      // Step 1: Create a proposal
      transaction = await dao.connect(investor1).createProposal('Proposal for Refund', ether(200), recipient.address);
      result = await transaction.wait();

      // Step 2: Have investors vote on the proposal
      await dao.connect(investor1).vote(1);
      await dao.connect(investor2).vote(1);
    })

    it('Allows investor to claim refund after failed proposal', async () => {
      // Reduce DAO's ether to ensure the proposal will fail.
      await dao.connect(funder).sendTransaction({ value: -ether(50) })

      // Step 3: Finalize the proposal (this should fail due to lack of funds in DAO)
      await dao.connect(investor1).finalizeProposal(1)

      const proposal = await dao.proposals(1)
      expect(proposal.failed).to.equal(true)

      // Step 4: Check investor's balance before claiming refund
      initialBalance = await ethers.provider.getBalance(investor1.address);

      // Step 5: Claim refund
      transaction = await dao.connect(investor1).claimRefund(1);
      await transaction.wait();

      // The investor's balance after the refund should be higher due to the refund, ignoring gas costs
      expect(await ethers.provider.getBalance(investor1.address)).to.gt(initialBalance);

      // Step 6: Ensure the refund mapping is updated
      const refundAmount = await dao.refunds(1, investor1.address);
      expect(refundAmount).to.equal(0);
    });

    it('Reverts if non-investor tries to claim a refund', async () => {
      await dao.connect(investor1).finalizeProposal(1);
      await expect(dao.connect(user).claimRefund(1)).to.be.revertedWith("No funds to claim or already claimed");
    });

    it('Reverts if investor tries to claim refund for a successful proposal', async () => {
      await dao.connect(investor1).finalizeProposal(1);
      const proposal = await dao.proposals(1);
      if (!proposal.failed) {
        await expect(dao.connect(investor1).claimRefund(1)).to.be.revertedWith("Proposal did not fail");
      }
    });

    it('Reverts if investor tries to double claim', async () => {
      await dao.connect(investor1).finalizeProposal(1);
      await dao.connect(investor1).claimRefund(1);
      await expect(dao.connect(investor1).claimRefund(1)).to.be.revertedWith("No funds to claim or already claimed");
    });
  });

})
