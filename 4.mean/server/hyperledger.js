var Fabric_Client = require('fabric-client');
var path = require('path');

class HyperledgerNetwork {

	constructor(){
		// Configure the correct Hyperledger environment
		// NOTE: When run as container, use container names
		this.ordererAddress = 'grpc://localhost:7050';
		this.peerAddress = 'grpc://localhost:7051';
		this.eventhubAddress = 'grpc://localhost:7053';
		this.channelName = 'mychannel';
		this.chaincodeId = 'fabcar';
		this.appUser = 'user1';

		this.store_path = path.join(__dirname, 'hfc-key-store');

		// Global private variables used by different functions
		this.fabric_client = null;
		this.channel = null;
		this.member_user = null;
		this.tx_id = null;
	}

	init(){
		this.fabric_client = new Fabric_Client();
		this.channel = this.fabric_client.newChannel(this.channelName);
		var peer = this.fabric_client.newPeer(this.peerAddress);
		this.channel.addPeer(peer);
		var order = this.fabric_client.newOrderer(this.ordererAddress)
		this.channel.addOrderer(order);

		console.log('Initialized');
		return Fabric_Client.newDefaultKeyValueStore({ path: this.store_path});
	}

	prepareUserContext(state_store) {
		this.fabric_client.setStateStore(state_store);
		var crypto_suite = Fabric_Client.newCryptoSuite();
		var crypto_store = Fabric_Client.newCryptoKeyStore({path: this.store_path});
		crypto_suite.setCryptoKeyStore(crypto_store);
		this.fabric_client.setCryptoSuite(crypto_suite);
		console.log('user context defined');
		return this.fabric_client.getUserContext(this.appUser, true);
	};

	commitTransaction(results) {
		var proposalResponses = results[0];
		var proposal = results[1];
		let isProposalGood = false;
		if (proposalResponses && proposalResponses[0].response &&
			proposalResponses[0].response.status === 200) {
				isProposalGood = true;
				console.log('Transaction proposal was good');
			} else {
				console.error('Transaction proposal was bad');
			}
		if (isProposalGood) {
			console.log('Successfully sent Proposal and received ProposalResponse: Status - ' + proposalResponses[0].response.status + ', message - "' + proposalResponses[0].response.message + '"');
	
			// build up the request for the orderer to have the transaction committed
			var request = {
				proposalResponses: proposalResponses,
				proposal: proposal
			};
	
			// set the transaction listener and set a timeout of 30 sec
			// if the transaction did not get committed within the timeout period,
			// report a TIMEOUT status
			var transaction_id_string = this.tx_id.getTransactionID(); //Get the transaction ID string to be used by the event processing
			var promises = [];
	
			console.log('send transaction: ' + request);

			var sendPromise = this.channel.sendTransaction(request);
			promises.push(sendPromise); //we want the send transaction first, so that we know where to check status

			console.log('transaction sent');
	
			// get an eventhub once the fabric client has a user assigned. The user
			// is required bacause the event registration must be signed
			let event_hub = this.fabric_client.newEventHub();
			event_hub.setPeerAddr(this.eventhubAddress);
	
			// using resolve the promise so that result status may be processed
			// under the then clause rather than having the catch clause process
			// the status
			let txPromise = new Promise((resolve, reject) => {
				let handle = setTimeout(() => {
					event_hub.disconnect();
					resolve({event_status : 'TIMEOUT'}); //we could use reject(new Error('Trnasaction did not complete within 30 seconds'));
				}, 3000);
				event_hub.connect();
				event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
					// this is the callback for transaction event status
					// first some clean up of event listener
					clearTimeout(handle);
					event_hub.unregisterTxEvent(transaction_id_string);
					event_hub.disconnect();
	
					// now let the application know what happened
					var return_status = {event_status : code, tx_id : transaction_id_string};
					if (code !== 'VALID') {
						console.error('The transaction was invalid, code = ' + code);
						resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
					} else {
						console.log('The transaction has been committed on peer ' + event_hub._ep._endpoint.addr);
						resolve(return_status);
					}
				}, (err) => {
					//this is the callback if something goes wrong with the event registration or processing
					reject(new Error('There was a problem with the eventhub ::'+err));
				});
			});
			promises.push(txPromise);
	
			return Promise.all(promises);
		} else {
			console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
			throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
		}
	}

	// Chaincode method calls

	query(user_from_store) {
		if (user_from_store && user_from_store.isEnrolled()) {
			console.log('Successfully loaded user1 from persistence');
			this.member_user = user_from_store;
		} else {
			throw new Error('Failed to get user1.... run registerUser.js');
		}
		const request = {
			chaincodeId: this.chaincodeId,
			fcn: 'queryAllCars',
			args: ['']
		};

		console.log('Request: ' + JSON.stringify(request));

		return this.channel.queryByChaincode(request);
	};

	update(user_from_store, newId, carBrand, carModel, carColor, carOwner) {
		if (user_from_store && user_from_store.isEnrolled()) {
			console.log('Successfully loaded user1 from persistence');
			this.member_user = user_from_store;
		} else {
			throw new Error('Failed to get user1.... run registerUser.js');
		}

		this.tx_id = this.fabric_client.newTransactionID();
		console.log("Assigning transaction_id: ", this.tx_id._transaction_id);

		var sendArgs = [newId, carBrand, carModel, carColor, carOwner];
		const request = {
			chaincodeId: this.chaincodeId,
			fcn: 'createCar',
			args: sendArgs,
			chainId: this.channelName,
			txId: this.tx_id
		};

		console.log('Request: ' + JSON.stringify(request));

		return this.channel.sendTransactionProposal(request);
	};

}
module.exports = HyperledgerNetwork;