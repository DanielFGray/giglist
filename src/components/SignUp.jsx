import React, { Component } from 'react'
import { Link } from 'react-router-dom'
import {
  Button,
  Card,
  Form,
  Input,
  Message,
} from 'semantic-ui-react'

const padded = { margin: '3px 0' }

class SignUp extends Component {
  constructor(props) {
    super(props)
    this.state = {
      loading: false,
      error: false,
      errorMessage: false,
    }
  }

  submit = e => {
    e.preventDefault()
    this.setState({ loading: true }, () =>
      setTimeout(() =>
        this.setState({
          loading: false,
          error: true,
          errorMessage: 'There was an error processing your request',
        }), 500))
  }

  // checkEmail = () => {
  //   debounce keystrokes
  //   e.target.value
  // }

  // checkPasswords = () => {
  //   if ()
  // }

  render() {
    return (
      <div style={{ padding: '10px', margin: '0 auto', maxWidth: '350px' }}>
        <Form
          action="/api/v1/signup"
          method="post"
          error={this.state.error}
          loading={this.state.loading}
          onSubmit={this.submit}
        >
          <Message
            error
            header="Error"
            content={this.state.errorMessage}
          />
          <Card fluid style={{ textAlign: 'center' }}>
            <Card.Content>
              {[
                { label: 'Sign up with Facebook', icon: 'facebook', color: 'facebook', onClick: this.submit },
                { label: 'Sign up with Twitter', icon: 'twitter', color: 'twitter', onClick: this.submit },
                { label: 'Sign up with Google', icon: 'google', color: 'google plus', onClick: this.submit },
              ].map(e =>
                <div key={e.icon} style={padded}>
                  <Button {...e} />
                </div>
              )}
            </Card.Content>
            <Card.Content extra>
              <div style={padded}>
                <Input label="email" type="text" name="email" fluid onChange={this.checkEmail} />
              </div>
              <div style={padded}>
                <Input label="password" type="password" name="password" fluid onChange={this.checkPasswords} />
              </div>
              <div style={padded}>
                <Input label="password" type="password" name="confirm_password" fluid onChange={this.checkPasswords} />
              </div>
              <div style={padded}>
                <Button color="blue" content="submit" type="submit" value="Sign In" />
              </div>
            </Card.Content>
            <Card.Content extra>
              <div style={padded}><Link to="/signin">Already have an account?</Link></div>
            </Card.Content>
          </Card>
        </Form>
      </div>
    )
  }
}

export default SignUp
