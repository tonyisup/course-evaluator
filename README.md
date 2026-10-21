# Course Evaluator Application
  
This is a project built with [Chef](https://chef.convex.dev) using [Convex](https://convex.dev) as its backend.
 You can find docs about Chef with useful information like how to deploy to production [here](https://docs.convex.dev/chef).
  
This project is connected to the Convex deployment named [`peaceful-kingfisher-275`](https://dashboard.convex.dev/d/peaceful-kingfisher-275).
  
## Project structure
  
The frontend code is in the `app` directory and is built with [Vite](https://vitejs.dev/).
  
The backend code is in the `convex` directory.
  
`npm run dev` will start the frontend and backend servers.

## AI model configuration

Evaluations are run through [OpenRouter](https://openrouter.ai). Set these environment variables on your Convex deployment:

```sh
npx convex env set OPENROUTER_API_KEY <your-openrouter-key>
npx convex env set OPENROUTER_MODEL anthropic/claude-haiku-5.5
```

`OPENROUTER_MODEL` can be any [OpenRouter model ID](https://openrouter.ai/models) that accepts image input and supports structured outputs (`response_format` with a JSON schema). Requests are only routed to providers that support structured outputs, so a model without it fails with an error from OpenRouter instead of returning unparseable text.

## App authentication

Chef apps use [Convex Auth](https://auth.convex.dev/) with Anonymous auth for easy sign in. You may wish to change this before deploying your app.

## Developing and deploying your app

Check out the [Convex docs](https://docs.convex.dev/) for more information on how to develop with Convex.
* If you're new to Convex, the [Overview](https://docs.convex.dev/understanding/) is a good place to start
* Check out the [Hosting and Deployment](https://docs.convex.dev/production/) docs for how to deploy your app
* Read the [Best Practices](https://docs.convex.dev/understanding/best-practices/) guide for tips on how to improve you app further

## HTTP API

User-defined http routes are defined in the `convex/router.ts` file. We split these routes into a separate file from `convex/http.ts` to allow us to prevent the LLM from modifying the authentication routes.
