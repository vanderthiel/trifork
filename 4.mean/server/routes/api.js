const express = require('express');
const router = express.Router();

const HyperledgerNetwork = require('../hyperledger');

router.get('/', (req, res) => {
	res.status(200).send("This is the default endpoint, it is not the endpoint you're looking for");
});

router.get('/cars', (req, res) => {
	var network = new HyperledgerNetwork();
	network.init()
	.then((state_store) => { return network.prepareUserContext(state_store); })
	.then((user_from_store) => { return network.query(user_from_store); })
	.then((query_responses) => {
		if (query_responses && query_responses.length == 1) {
			if (query_responses[0] instanceof Error) {
				console.error("error from query = ", query_responses[0]);
			} else {
			  res.status(200).send(JSON.parse(query_responses[0].toString()));
			}
		} else {
      res.status(400).send("No payloads were returned from query");
		}
	}).catch((err) => {
    res.status(400).send('Failed to query successfully :: ' + err);
	});
});

router.post('/cars', (req, res) => {
	var id = req.body.id;
	var brand = req.body.brand;
	var model = req.body.model;
	var color = req.body.color;
	var owner = req.body.owner;

	if(!id || !brand || !model || !color || !owner) {
		res.status(400).send({ success: false, message: 'One or more parameters are missing' });
		return;
	}

	var network = new HyperledgerNetwork();
	network.init()
	.then((state_store) => { return network.prepareUserContext(state_store); })
	.then((user_from_store) => { return network.update(user_from_store, id, brand, model, color, owner); })
	.then((results) => { return network.commitTransaction(results); })
	.then((results) => {
		console.log('Send transaction promise and event listener promise have completed');
		// check the results in the order the promises were added to the promise all list
		if (results && results[0] && results[0].status === 'SUCCESS') {
			console.log('Successfully sent transaction to the orderer.');
		} else {
			console.error('Failed to order the transaction. Error code: ' + response.status);
      res.status(400).send({ success: false });
      return;
		}
	
		if(results && results[1] && results[1].event_status === 'VALID') {
			console.log('Successfully committed the change to the ledger by the peer');
		} else {
			console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);
      res.status(400).send({ success: false });
      return;
		}

  	res.status(200).send({ success: true });
	}).catch((err) => {
		res.status(400).send('Failed to update :: ' + err);
	});
});

module.exports = router;
