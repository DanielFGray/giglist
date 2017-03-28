// import React, { Component, PropTypes } from 'react'
import React from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  Card,
  Form,
  Input,
} from 'semantic-ui-react'

const padded = { margin: '3px 0' }

const SignIn = () => (
  <div style={{ padding: '10px', margin: '0 auto', maxWidth: '350px' }}>
    <Form action="/login" method="post">
      <Card fluid style={{ textAlign: 'center' }}>
        <Card.Content>
          <div style={padded}>
            <Button color="facebook" icon="facebook" label="Sign in with Facebook" />
          </div>
          <div style={padded}>
            <Button color="twitter" icon="twitter" label="Sign in with Twitter" />
          </div>
          <div style={padded}>
            <Button color="google plus" icon="google" label="Sign in with Google" />
          </div>
        </Card.Content>
        <Card.Content extra>
          <div style={padded}>
            <Input label="username" type="text" name="username" fluid />
          </div>
          <div style={padded}>
            <Input label="password" type="password" name="password" fluid />
          </div>
          <div style={padded}>
            <Button color="blue" content="submit" type="submit" value="Sign In" />
          </div>
        </Card.Content>
        <Card.Content extra>
          <div style={padded}>
            <Link to="/forgot">Forgot your password?</Link>
          </div>
        </Card.Content>
      </Card>
    </Form>
  </div>
)

export default SignIn
