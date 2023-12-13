//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import "hardhat/console.sol";
import "./Token.sol";

contract DAO {
    address owner;
    Token public token;
    uint256 public quorum;

    struct Proposal {
        uint256 id;
        string name;
        uint256 amount;
        address payable recipient;
        uint256 votes;
        bool finalized;
        address[] voters;
        bool failed;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) public proposals;

    mapping(address => mapping(uint256 => bool)) votes;

    //refund mapping
    mapping(uint256 => mapping(address => uint256)) public refunds;

    event Propose(uint id, uint256 amount, address recipient, address creator);
    event Vote(uint256 id, address investor);
    event Finalize(uint256 id);

    constructor(Token _token, uint256 _quorum) {
        owner = msg.sender;
        token = _token;
        quorum = _quorum;
    }

    // Allow contract to receive ether
    receive() external payable {}

    modifier onlyInvestor() {
        require(token.balanceOf(msg.sender) > 0, "must be token holder");
        _;
    }

    function getHasVoted(
        address _voter,
        uint256 _proposalId
    ) public view returns (bool) {
        return votes[_voter][_proposalId];
    }

    // Create proposal
    function createProposal(
        string memory _name,
        uint256 _amount,
        address payable _recipient
    ) external onlyInvestor {
        require(address(this).balance >= _amount);

        proposalCount++;

        // Initialize all fields including the voters array
        proposals[proposalCount] = Proposal({
            id: proposalCount,
            name: _name,
            amount: _amount,
            recipient: _recipient,
            votes: 0,
            finalized: false,
            voters: new address[](0), // Initialize the voters array here
            failed: false
        });

        emit Propose(proposalCount, _amount, _recipient, msg.sender);
    }

    // Vote on proposal
    function vote(uint256 _id) external onlyInvestor {
        Proposal storage proposal = proposals[_id];
        require(!votes[msg.sender][_id], "already voted");

        uint256 voteWeight = token.balanceOf(msg.sender);
        proposal.votes += voteWeight;

        // Store voter for refund purposes
        proposal.voters.push(msg.sender);
        refunds[_id][msg.sender] = voteWeight;

        votes[msg.sender][_id] = true;
        emit Vote(_id, msg.sender);
    }

    // Finalize proposal & tranfer funds
    function finalizeProposal(uint256 _id) external onlyInvestor {
        Proposal storage proposal = proposals[_id];
        require(!proposal.finalized, "proposal already finalized");
        require(
            proposal.votes >= quorum,
            "must reach quorum to finalize proposal"
        );

        if (address(this).balance >= proposal.amount) {
            (bool sent, ) = proposal.recipient.call{value: proposal.amount}("");
            if (!sent) {
                proposal.failed = true;
                return;
            }
        } else {
            proposal.failed = true;
            return;
        }

        proposal.finalized = true;
        emit Finalize(_id);
    }

    function claimRefund(uint256 _id) external {
        Proposal storage proposal = proposals[_id];
        require(proposal.failed, "Proposal did not fail");
        uint256 owedAmount = refunds[_id][msg.sender];
        require(owedAmount > 0, "No funds to claim or already claimed");

        refunds[_id][msg.sender] = 0; // Reset refund
        (bool sent, ) = msg.sender.call{value: owedAmount}("");
        require(sent, "Failed to send refund");
    }
}
