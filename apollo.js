// const gql = require("graphql-tag");
const ApolloClient = require("apollo-client").ApolloClient;
const fetch = require("node-fetch");
const createHttpLink = require("apollo-link-http").createHttpLink;
const setContext = require("apollo-link-context").setContext;
const InMemoryCache = require("apollo-cache-inmemory").InMemoryCache;

const STRATZ_API_TOKEN = require('./stratzAuth');
const queries = require('./queries');

const httpLink = createHttpLink({
  uri: 'https://api.stratz.com/graphql',
  fetch: fetch
});

const authLink = setContext((_, { headers }) => {
  // get the authentication token from local storage if it exists
  const token = STRATZ_API_TOKEN
  // return the headers to the context so httpLink can read them
  return {
    headers: {
      ...headers,
      authorization: token ? `Bearer ${token}` : "",
    }
  }
});

const client = new ApolloClient({
  link: authLink.concat(httpLink),
  cache: new InMemoryCache()
});

const query = async (res) => {
  // if (!req.body || !req.body.query) {
  //   res.sendStatus(500);
  //   return;
  // }

  // const query = queries.test;
  // let variables = undefined;
  // if (req.body.variables) {
  //   variables = JSON.parse(decodeURIComponent(req.body.variables));
  // }

  try {
    const result = await client.query({
      query,
      variables
    });
    res.json(result);
  } catch (err) {
    console.log(err);
    res.sendStatus(500).send(JSON.stringify(err));
  }
};

const apollo = async (req, res, next) => {
  switch (req.method) {
    case "GET":
    default:
      await query(res);
  }

  next();
};

module.exports = apollo;
