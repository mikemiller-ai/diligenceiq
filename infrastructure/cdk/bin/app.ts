import { App } from 'aws-cdk-lib';
import { buildApp } from '../lib/build-app';

const app = new App();
buildApp(app);
app.synth();
